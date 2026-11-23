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

  // Modelo de recusa (21/11/2026; texto no estilo "Aceitar" desde 23/11/2026):
  // o Google e a Meta já carregaram ao abrir a página (ver lib/medicao.ts).
  // "Aceitar" só fecha o aviso; não dispara o evento de consentimento, que
  // contaria a página vista de novo. "Recusar" continua no aviso, discreto,
  // porque a recusa precisa ser fácil (LGPD).
  function accept() {
    try { localStorage.setItem(STORAGE_KEY, "accepted"); } catch { /* aba privada */ }
    setVisible(false);
  }

  // Os scripts do Google e da Meta já estão na página e não há como
  // descarregá-los: recarrega, e com a recusa gravada nenhum dos dois sobe.
  function reject() {
    try { localStorage.setItem(STORAGE_KEY, "rejected"); } catch { /* aba privada */ }
    setVisible(false);
    window.location.reload();
  }

  if (!visible) return null;

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Aviso de cookies"
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
        Usamos cookies para garantir que você tenha a melhor experiência em nosso site. Ao continuar navegando ou clicar em “Aceitar”, você concorda que podemos usar esses cookies. Clique em{" "}
        <a href="/privacidade" style={{ color: "#D4E8D5", textDecoration: "underline" }}>
          Política de Privacidade
        </a>{" "}
        para consultar mais informações.
      </p>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
        <button
          onClick={accept}
          style={{
            background: "#5A8C5E",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            padding: "10px 28px",
            fontSize: 14,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Aceitar
        </button>
        <button
          onClick={reject}
          style={{
            background: "transparent",
            color: "rgba(212,232,213,0.75)",
            border: "none",
            padding: "4px 2px",
            fontSize: 12.5,
            fontWeight: 500,
            textDecoration: "underline",
            cursor: "pointer",
          }}
        >
          Recusar
        </button>
      </div>
    </div>
  );
}
