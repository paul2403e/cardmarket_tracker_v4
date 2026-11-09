"use client";

// Startseite: direkt zum zuletzt gewählten Spiel (Standard Pokémon).
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { gameHref, rememberedGame } from "@/lib/games";

export default function Start() {
  const router = useRouter();
  useEffect(() => router.replace(gameHref(rememberedGame())), [router]);
  return <p className="py-10 text-slate">Loading…</p>;
}
