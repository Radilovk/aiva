#!/usr/bin/env python3
"""Keep the header and footer of every page in frontend/school identical.

Each page marks the shared parts with <!-- chrome:head --> … <!-- /chrome:head --> and
<!-- chrome:foot --> … <!-- /chrome:foot -->. The head carries the page's active link as
<!-- chrome:head active="results.html" -->. Run after changing the menu or the footer:

    python3 scripts/school-chrome.py           # rewrite in place
    python3 scripts/school-chrome.py --check   # exit 1 if a page is out of date
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent / "frontend" / "school"

STRIP = """<a class="skip" href="#main">Към съдържанието</a>
<div class="gov-strip"><div class="wrap"><span class="long">Независима платформа за анонимна обратна връзка от родители и ученици</span><span class="sp"></span><span>Телефон за деца: <a href="tel:116111">116 111</a></span></div></div>"""

NAV = [("./", "Начало", True), ("survey.html", "Анкета", False), ("results.html", "Резултати", False),
       ("methodology.html", "Методология", True), ("about.html", "За нас", True)]

FOOT = """<footer class="site-foot">
  <div class="wrap">
    <div class="cols">
      <div><h4>SchoolRating.eu</h4><p style="margin:0">Независима платформа за анонимна обратна връзка от родители и ученици за училищната среда. Не е част от Министерството на образованието и науката или от регионалните управления на образованието.</p></div>
      <div><h4>Платформата</h4><ul><li><a href="survey.html">Анкета</a></li><li><a href="results.html">Резултати</a></li><li><a href="methodology.html">Методология</a></li><li><a href="schools.html">За училища и РУО</a></li><li><a href="results.html#/login">Вход с ключ</a></li></ul></div>
      <div><h4>Организацията</h4><ul><li><a href="about.html">За нас</a></li><li><a href="faq.html">Въпроси и отговори</a></li><li><a href="contact.html">Контакт</a></li><li><a href="child-safety.html">Ако дете е в опасност</a></li></ul></div>
      <div><h4>Правна информация</h4><ul><li><a href="privacy.html">Поверителност и лични данни</a></li><li><a href="terms.html">Условия за ползване</a></li><li><a href="accessibility.html">Достъпност</a></li></ul></div>
    </div>
    <div class="base"><span>© 2026 <span data-org="legal_name" data-fallback="brand"></span></span><span data-org-line="eik">ЕИК <span data-org="eik"></span></span><span class="sp"></span><a data-org-href="source_code">Изходен код</a><span>Снимки: Unsplash</span></div>
  </div>
</footer>"""


def head(active: str) -> str:
    links = "".join(
        f'<a href="{href}"{" aria-current=\"page\"" if href == active else ""}{" class=\"opt-link\"" if optional else ""}>{label}</a>'
        for href, label, optional in NAV)
    return f"""{STRIP}
<header class="site-head">
  <div class="wrap">
    <a class="brand" href="./"><span class="brand-mark" data-icon="mark"></span><span class="brand-name">SchoolRating.eu<small>Обратна връзка за училищната среда</small></span></a>
    <nav class="site-nav" aria-label="Основно меню">{links}</nav>"""


HEAD_RE = re.compile(r'<!-- chrome:head active="([^"]*)" -->.*?<!-- /chrome:head -->', re.S)
FOOT_RE = re.compile(r"<!-- chrome:foot -->.*?<!-- /chrome:foot -->", re.S)


def render(text: str) -> str:
    text = HEAD_RE.sub(lambda m: f'<!-- chrome:head active="{m[1]}" -->\n{head(m[1])}\n<!-- /chrome:head -->', text)
    return FOOT_RE.sub(f"<!-- chrome:foot -->\n{FOOT}\n<!-- /chrome:foot -->", text)


def main() -> int:
    stale = []
    for page in sorted(ROOT.glob("*.html")):
        old = page.read_text(encoding="utf-8")
        new = render(old)
        if new != old:
            stale.append(page.name)
            if "--check" not in sys.argv:
                page.write_text(new, encoding="utf-8")
    if "--check" in sys.argv and stale:
        print("out of date:", ", ".join(stale))
        return 1
    print("updated:" if stale else "up to date", ", ".join(stale))
    return 0


if __name__ == "__main__":
    sys.exit(main())
