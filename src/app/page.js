"use client";

import Link from "next/link";
import Image from "next/image";
import icon from "./icon.png";
import { hapticTap } from "@/lib/haptic";

export default function Home() {
  return (
    <main className="landing">
      <div className="landing__content">
        <div className="landing__icons-row">
          <div className="landing__icon-wrap landing__icon-wrap--left">
            <Image
              src={icon}
              alt=""
              width={100}
              height={100}
              className="landing__icon"
            />
          </div>
          <div className="landing__icon-wrap landing__icon-wrap--right">
            <Image
              src={icon}
              alt=""
              width={100}
              height={100}
              className="landing__icon"
            />
          </div>
        </div>
        <h1 className="landing__title">Close Family Cowboy & Cocktail Evening</h1>
        <p className="landing__subtitle">Share your photos and browse everyone’s memories.</p>
        <div className="landing__actions">
          <Link href="/upload" className="landing__btn landing__btn--primary" onClick={hapticTap}>
            <span>Upload Photos</span>
            <span className="landing__arrow" aria-hidden>→</span>
          </Link>
          <Link href="/gallery" className="landing__btn landing__btn--secondary" onClick={hapticTap}>
            <span>View Gallery</span>
            <span className="landing__arrow" aria-hidden>→</span>
          </Link>
        </div>
        <p className="landing__hint">
          Add photos from your device or view and download the full gallery.
        </p>
      </div>
    </main>
  );
}
