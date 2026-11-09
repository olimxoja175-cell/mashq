"""Real-browser end-to-end test (Chrome via Playwright, fake camera/microphone).

Prerequisites: backend on :8000 and frontend on :3000 in development mode with a
fresh demo database. Run:   python e2e/browser_e2e.py [--headed]

Covers: login + MFA, meeting creation, invitation acceptance, two-browser WebRTC
media connection, Uzbek->Chinese and Chinese->Uzbek interpretation delivered as
subtitles, no self-translation, microphone control, network drop + recovery,
Arabic RTL layout, desktop/tablet/mobile screenshots."""
from __future__ import annotations

import os
import sys
import time

from playwright.sync_api import Page, expect, sync_playwright

BASE = os.environ.get("WV_E2E_URL", "http://localhost:3000")
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "docs", "screenshots")
PW = "WorldVoice#2026"
results: list[tuple[str, bool, str]] = []


def check(name: str, fn):
    t0 = time.time()
    try:
        fn()
        results.append((name, True, f"{time.time() - t0:.1f}s"))
        print(f"  PASS  {name}")
    except Exception as e:  # noqa: BLE001
        results.append((name, False, str(e).splitlines()[0][:200]))
        print(f"  FAIL  {name}: {e}")


def shot(page: Page, name: str):
    os.makedirs(OUT, exist_ok=True)
    page.screenshot(path=os.path.join(OUT, f"{name}.png"))


def login(page: Page, email: str):
    page.goto(f"{BASE}/login")
    page.fill("input[type=email]", email)
    page.fill("input[type=password]", PW)
    page.get_by_role("button", name="Continue to identity verification").click()
    page.wait_for_url("**/verify")
    page.locator("button.font-mono").click()  # development-mode code hint fills the digits
    page.get_by_role("button", name="Verify", exact=True).click()
    page.wait_for_url("**/dashboard", timeout=15000)


def main(headed: bool):
    with sync_playwright() as p:
        browser = p.chromium.launch(
            channel="chrome",
            headless=not headed,
            args=["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
        )
        vp = {"width": 1600, "height": 900}
        ctx_a = browser.new_context(viewport=vp, permissions=["camera", "microphone"])
        ctx_b = browser.new_context(viewport=vp, permissions=["camera", "microphone"])
        a, b = ctx_a.new_page(), ctx_b.new_page()
        for name, pg in (("A", a), ("B", b)):
            pg.on("console", lambda m, n=name: m.type in ("warning", "error") and print(f"    [{n} console.{m.type}] {m.text[:200]}"))
            pg.on("pageerror", lambda e, n=name: print(f"    [{n} pageerror] {e} :: {(e.stack or '')[:600]}"))
        mid = {}

        print("WORLDVOICE browser E2E")
        check("login + MFA (Uzbek president)", lambda: login(a, "uz.president@demo.worldvoice"))
        check("login + MFA (Chinese president)", lambda: login(b, "cn.president@demo.worldvoice"))
        shot(a, "01-dashboard-desktop")

        def create():
            a.goto(f"{BASE}/meetings/new")
            a.fill("input[placeholder^='Bilateral']", "Uzbekistan–China summit (E2E)")
            a.get_by_role("button", name="Li Wenhua (demo)").click()
            shot(a, "02-create-meeting")
            a.get_by_role("button", name="Create and enter room").click()
            a.wait_for_url("**/meeting/**")
            mid["id"] = a.url.rstrip("/").split("/")[-1]
        check("create meeting with invitation", create)

        def join_a():
            a.get_by_role("switch", name="Enable AI interpretation of my speech").click()
            shot(a, "03-lobby")
            a.get_by_role("button", name="Uchrashuvga qo'shilish").click()  # UI is in Uzbek for this official
            expect(a.get_by_text("Ulangan")).to_be_visible(timeout=15000)
        check("host joins room (AI consent given)", join_a)

        def accept_b():
            b.goto(f"{BASE}/invitations")
            b.get_by_role("button", name="接受").first.click()
            b.wait_for_timeout(800)
            b.goto(f"{BASE}/meeting/{mid['id']}")
            b.get_by_role("switch", name="Enable AI interpretation of my speech").click()
            b.get_by_role("button", name="加入会议").click()
            expect(b.get_by_text("已连接")).to_be_visible(timeout=15000)
        check("invitee accepts invitation and joins", accept_b)

        def media():
            # both tiles visible, peer connection established (no 'Connecting media' overlay)
            expect(a.get_by_text("Li Wenhua (demo)").first).to_be_visible(timeout=10000)
            expect(a.get_by_text("Connecting media")).to_have_count(0, timeout=20000)
            expect(b.get_by_text("Connecting media")).to_have_count(0, timeout=20000)
            js = "() => [...document.querySelectorAll('video')].filter(v => v.srcObject && v.readyState >= 2 && v.videoWidth > 0).length"
            for pg in (a, b):
                pg.wait_for_function(js.replace("() =>", "() => (") + ") >= 2", timeout=15000)
        check("WebRTC audio/video connected peer-to-peer", media)

        def uz_to_zh():
            a.get_by_role("button", name="Xayrli kun, janob Prezident.").click()
            expect(b.get_by_text("下午好，总统先生。").first).to_be_visible(timeout=10000)
            shot(b, "04-room-chinese-listener")
        check("Uzbek -> Chinese interpretation delivered (subtitle + transcript)", uz_to_zh)

        def zh_to_uz():
            b.get_by_role("button", name="谢谢。再见。").click() if b.get_by_role("button", name="谢谢。再见。").count() else None
            b.fill("input[placeholder^='输入发言']", "我们愿意加强我们两国之间的合作。")
            b.get_by_role("button", name="发送").click()
            expect(a.get_by_text("Biz mamlakatlarimiz oʻrtasidagi hamkorlikni mustahkamlashga tayyormiz.").first).to_be_visible(timeout=10000)
            shot(a, "05-room-uzbek-listener")
        check("Chinese -> Uzbek interpretation delivered", zh_to_uz)

        def no_self():
            # the Uzbek speaker sees their own recognised words, never a Chinese translation of them
            assert a.get_by_text("下午好，总统先生。").count() == 0
        check("speaker never receives own translation", no_self)

        def mic_toggle():
            a.get_by_role("button", name="Mikrofon").click()
            expect(b.get_by_text("MIC OFF")).to_be_visible(timeout=8000)
            a.get_by_role("button", name="Mikrofon").click()
            expect(b.get_by_text("MIC OFF")).to_have_count(0, timeout=8000)
        check("microphone control propagates to other participant", mic_toggle)

        def cam_toggle():
            a.get_by_role("button", name="Kamera").click()
            b.wait_for_timeout(800)
            a.get_by_role("button", name="Kamera").click()
        check("camera control", cam_toggle)

        def recovery():
            a.get_by_role("button", name="Sozlamalar").click()
            a.get_by_role("button", name="Test network recovery (drop connection)").click()
            expect(a.get_by_text("Qayta ulanmoqda…")).to_be_visible(timeout=5000)
            expect(a.get_by_text("Ulangan")).to_be_visible(timeout=20000)
            expect(a.get_by_text("Connecting media")).to_have_count(0, timeout=25000)
            a.get_by_role("button", name="Stenogramma").first.click()
            a.get_by_role("button", name="Keling, savdo va investitsiyalarni muhokama qilaylik.").click()
            expect(b.get_by_text("让我们讨论贸易和投资。").first).to_be_visible(timeout=10000)
        check("network interruption: reconnect, media restored, interpretation resumes", recovery)

        def responsive():
            for name, size in [("06-room-tablet-landscape", (1024, 768)), ("07-room-tablet-portrait", (820, 1180)), ("08-room-mobile", (390, 844))]:
                b.set_viewport_size({"width": size[0], "height": size[1]})
                b.wait_for_timeout(500)
                overflow = b.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")
                assert overflow <= 2, f"{name}: horizontal overflow {overflow}px"
                shot(b, name)
            b.set_viewport_size(vp)
            b.goto(f"{BASE}/dashboard")
            b.set_viewport_size({"width": 820, "height": 1180})
            b.wait_for_timeout(500)
            shot(b, "09-dashboard-tablet")
            assert b.evaluate("() => document.documentElement.scrollWidth - window.innerWidth") <= 2
        check("tablet and mobile layouts (no horizontal overflow)", responsive)

        def leave():
            a.get_by_role("button", name="Uchrashuvni yakunlash").click()
            a.wait_for_url("**/meetings/history", timeout=10000)
        check("host ends meeting", leave)

        ctx_c = browser.new_context(viewport=vp)
        c = ctx_c.new_page()

        def arabic():
            login(c, "eg.president@demo.worldvoice")
            assert c.evaluate("() => document.documentElement.dir") == "rtl"
            assert c.evaluate("() => document.documentElement.lang") == "ar"
            expect(c.get_by_text("لوحة التحكم").first).to_be_visible()
            shot(c, "10-dashboard-arabic-rtl")
            c.goto(f"{BASE}/settings/language")
            shot(c, "11-language-settings-rtl")
        check("Arabic official: right-to-left interface", arabic)

        def admin():
            ctx_d = browser.new_context(viewport=vp)
            d = ctx_d.new_page()
            login(d, "admin@demo.worldvoice")
            d.goto(f"{BASE}/admin/monitoring")
            expect(d.get_by_text("Hash chain intact")).to_be_visible(timeout=10000)
            shot(d, "12-monitoring")
            d.goto(f"{BASE}/admin/access")
            shot(d, "13-access-management")
            d.goto(f"{BASE}/admin")
            shot(d, "14-admin-users")
        check("admin monitoring + access management + audit chain", admin)

        a.goto(f"{BASE}/login")
        shot(a, "00-login")
        browser.close()

    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n{passed}/{len(results)} browser checks passed")
    with open(os.path.join(OUT, "..", "e2e-results.md"), "w", encoding="utf-8") as f:
        f.write("# Browser E2E results\n\n| Check | Result | Detail |\n|---|---|---|\n")
        for n, ok, d in results:
            f.write(f"| {n} | {'PASS' if ok else 'FAIL'} | {d} |\n")
    sys.exit(0 if passed == len(results) else 1)


if __name__ == "__main__":
    main("--headed" in sys.argv)
