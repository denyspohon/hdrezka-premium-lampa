import re

# HDREZKA Premium search compatibility patch.
# Uses Rezka's live-search endpoint directly instead of the library's
# full search page parser, which currently returns empty results on some mirrors.

try:
    from bs4 import BeautifulSoup
    from hdrezka.api.search import Search
    from hdrezka.post.inline import InlineItem, InlineInfo

    async def _get_page_quick(self, page=1, **kwargs):
        if page not in (None, 1):
            return []

        url = self.client.host_join('engine/ajax/search.php')

        response = await self.client.get_response(
            'GET',
            url,
            params={'q': self.query},
            headers={
                'Referer': self.client.host,
                'X-Requested-With': 'XMLHttpRequest',
            },
        )

        response.raise_for_status()

        html = response.text or ''
        soup = BeautifulSoup(html, 'html.parser')

        rows = []
        seen = set()

        selectors = [
            'div.b-search__live_section ul li',
            '.b-search__live_section li',
            'li',
        ]

        nodes = []
        for selector in selectors:
            nodes = soup.select(selector)
            if nodes:
                break

        for node in nodes:
            anchor = node.find('a', href=True)
            if not anchor:
                continue

            href = (anchor.get('href') or '').strip()
            if not href or href in seen:
                continue

            if '/search/' in href:
                continue

            seen.add(href)

            title_node = anchor.select_one('.enty')
            title = (
                title_node.get_text(' ', strip=True)
                if title_node
                else anchor.get_text(' ', strip=True)
            )

            full_text = anchor.get_text(' ', strip=True)
            year_match = re.search(r'\b((?:19|20)\d{2})\b', full_text)
            year = int(year_match.group(1)) if year_match else 0

            rows.append(
                InlineItem(
                    href,
                    title,
                    InlineInfo(year, None, '', ''),
                    '',
                    self.client,
                )
            )

        print(
            f'[hdrezka-premium] quick-search '
            f'query={self.query!r} status={response.status_code} results={len(rows)}'
        )

        return rows

    Search.get_page = _get_page_quick

    print('[hdrezka-premium] quick-search patch loaded')

except Exception as exc:
    print('[hdrezka-premium] quick-search patch failed:', repr(exc))
