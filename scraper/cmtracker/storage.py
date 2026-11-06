"""Speicherschicht: Cloudflare R2 (S3-kompatibel) oder lokaler Ordner als Ersatz.

Der lokale Ordner wird genutzt, wenn keine R2-Zugangsdaten gesetzt sind – für Tests
und für erste Läufe, bevor R2 eingerichtet ist.
"""

from __future__ import annotations

import io
import os
from pathlib import Path
from typing import Protocol

import pandas as pd

from .settings import R2Config, r2_config_from_env


class Storage(Protocol):
    def get(self, key: str) -> bytes | None: ...
    def put(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> None: ...
    def list(self, prefix: str) -> list[str]: ...
    def delete(self, key: str) -> None: ...
    def total_size(self, prefix: str = "") -> int: ...
    def describe(self) -> str: ...
    @property
    def is_persistent(self) -> bool: ...


class R2Storage:
    def __init__(self, cfg: R2Config):
        import boto3
        from botocore.config import Config

        self._bucket = cfg.bucket
        self._client = boto3.client(
            "s3",
            endpoint_url=cfg.endpoint_url,
            aws_access_key_id=cfg.access_key_id,
            aws_secret_access_key=cfg.secret_access_key,
            region_name="auto",
            config=Config(retries={"max_attempts": 5, "mode": "standard"}),
        )

    def get(self, key: str) -> bytes | None:
        from botocore.exceptions import ClientError

        try:
            obj = self._client.get_object(Bucket=self._bucket, Key=key)
        except ClientError as err:
            if err.response.get("Error", {}).get("Code") in ("NoSuchKey", "404", "NotFound"):
                return None
            raise
        return obj["Body"].read()

    def put(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> None:
        self._client.put_object(Bucket=self._bucket, Key=key, Body=data, ContentType=content_type)

    def list(self, prefix: str) -> list[str]:
        keys: list[str] = []
        for page in self._client.get_paginator("list_objects_v2").paginate(Bucket=self._bucket, Prefix=prefix):
            keys.extend(obj["Key"] for obj in page.get("Contents", []))
        return sorted(keys)

    def delete(self, key: str) -> None:
        self._client.delete_object(Bucket=self._bucket, Key=key)

    def total_size(self, prefix: str = "") -> int:
        total = 0
        for page in self._client.get_paginator("list_objects_v2").paginate(Bucket=self._bucket, Prefix=prefix):
            total += sum(obj["Size"] for obj in page.get("Contents", []))
        return total

    def describe(self) -> str:
        return f"Cloudflare R2 (Bucket '{self._bucket}')"

    @property
    def is_persistent(self) -> bool:
        return True


class LocalStorage:
    def __init__(self, root: Path | str):
        self._root = Path(root)

    def _path(self, key: str) -> Path:
        path = (self._root / key).resolve()
        if self._root.resolve() not in path.parents:
            raise ValueError(f"Ungültiger Schlüssel: {key}")
        return path

    def get(self, key: str) -> bytes | None:
        path = self._path(key)
        return path.read_bytes() if path.exists() else None

    def put(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> None:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def list(self, prefix: str) -> list[str]:
        base = self._root.resolve()
        if not base.exists():
            return []
        return sorted(str(p.relative_to(base)).replace(os.sep, "/") for p in base.rglob("*")
                      if p.is_file() and str(p.relative_to(base)).replace(os.sep, "/").startswith(prefix))

    def delete(self, key: str) -> None:
        path = self._path(key)
        if path.exists():
            path.unlink()

    def total_size(self, prefix: str = "") -> int:
        base = self._root.resolve()
        return sum((base / k).stat().st_size for k in self.list(prefix)) if base.exists() else 0

    def describe(self) -> str:
        return f"Lokaler Ordner '{self._root}' (R2 nicht konfiguriert)"

    @property
    def is_persistent(self) -> bool:
        # In GitHub Actions ist der Ordner nach dem Lauf weg.
        return not os.environ.get("GITHUB_ACTIONS")


def storage_from_env() -> Storage:
    cfg = r2_config_from_env()
    if cfg:
        return R2Storage(cfg)
    return LocalStorage(os.environ.get("LOCAL_DATA_DIR", ".localdata"))


def df_to_parquet(df: pd.DataFrame, schema=None) -> bytes:
    """DataFrame als zstd-komprimiertes Parquet. Mit `schema` bleiben die Spaltentypen stabil,
    auch wenn eine Spalte an einem Tag nur leere Werte enthält."""
    import pyarrow as pa
    import pyarrow.parquet as pq

    table = pa.Table.from_pandas(df, schema=schema, preserve_index=False)
    buf = io.BytesIO()
    pq.write_table(table, buf, compression="zstd")
    return buf.getvalue()


def parquet_to_df(data: bytes) -> pd.DataFrame:
    return pd.read_parquet(io.BytesIO(data))
