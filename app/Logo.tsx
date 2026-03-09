"use client";

import { useState } from "react";

export default function Logo() {
  const [imgFailed, setImgFailed] = useState(false);

  if (imgFailed) {
    return (
      <svg
        className="logo-svg"
        viewBox="0 0 200 60"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="לוגו"
      >
        <rect width="200" height="60" rx="8" fill="#d32f2f" opacity={0.9} />
        <text x="100" y="38" textAnchor="middle" fill="white" fontSize="28" fontWeight="bold" fontFamily="Georgia, serif">
          GEDERA
        </text>
      </svg>
    );
  }

  return (
    <img
      src="/logo.png"
      alt="לוגו"
      onError={() => setImgFailed(true)}
      style={{ maxWidth: "100%", height: "auto" }}
    />
  );
}
