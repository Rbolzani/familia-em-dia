"use client";

import { useState, useEffect, useRef } from "react";

const STORAGE_KEY = "fam-cookie-consent";

export default function CookieBanner() {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const consent = localStorage.getItem(STORAGE_KEY);
    if (!consent) setVisible(true);
  }, []);

  // O banner é `position: fixed` e não ocupa espaço no fluxo, então cobria o
  // fim de qualquer página mais alta que a tela — no cadastro, o botão "Criar
  // conta" ficava atrás dele mesmo com a rolagem no fim, e a tela parecia
  // "travada". Publica a altura real numa variável de CSS; o globals.css a
  // usa como padding no fim do body e do container do app.
  //
  // ResizeObserver e não medida única: o texto quebra em mais linhas em telas
  // estreitas, e a altura muda com a rotação do aparelho.
  useEffect(() => {
    const el = ref.current;
    const root = document.documentElement;
    if (!visible || !el) {
      root.style.removeProperty("--cookie-banner-h");
      return;
    }
    const aplica = () => root.style.setProperty("--cookie-banner-h", `${el.offsetHeight}px`);
    aplica();
    const ro = new ResizeObserver(aplica);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty("--cookie-banner-h");
    };
  }, [visible]);

  function accept() {
    localStorage.setItem(STORAGE_KEY, "accepted");
    setVisible(false);
  }

  function reject() {
    localStorage.setItem(STORAGE_KEY, "rejected");
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Consentimento de cookies"
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        background: "#1E3320",
        color: "#F8F3EA",
        padding: "16px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        boxShadow: "0 -4px 24px rgba(0,0,0,0.25)",
      }}
    >
      <p style={{ fontSize: 13, lineHeight: 1.5, margin: 0 }}>
        Usamos cookies essenciais para o funcionamento do app e, com seu consentimento, cookies analíticos para melhorar a experiência. Seus dados são tratados conforme nossa{" "}
        <a href="/privacidade" style={{ color: "#D4E8D5", textDecoration: "underline" }}>
          Política de Privacidade
        </a>
        .
      </p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button
          onClick={accept}
          style={{
            background: "#5A8C5E",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            padding: "8px 20px",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Aceitar todos
        </button>
        <button
          onClick={reject}
          style={{
            background: "transparent",
            color: "#D4E8D5",
            border: "1px solid rgba(212,232,213,0.35)",
            borderRadius: 8,
            padding: "8px 20px",
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Somente essenciais
        </button>
      </div>
    </div>
  );
}
