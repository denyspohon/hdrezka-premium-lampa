import re
from urllib.parse import urljoin

# HDREZKA Premium search compatibility patch.
# Uses the same live-search request shape as Online Mod:
# POST /engine/ajax/search.php with body q=<query>

try:
    from bs4 import BeautifulSoup
    from hdrezka.api.search import Search
    from hdrezka.post.inline import InlineItem, InlineInfo

    def _clean_title(text):
        return re.sub(r'\s+', ' ', (text or '')).strip()

    def _extract_live_items(html, client):
        soup = BeautifulSoup(html or '', 'html.parser')
        rows = []
        seen = set()

        # Online Mod parses <li><a ...>...</a></li>
        nodes = soup.select('li')

        for node in nodes:
            anchor = node.find('a', href=True)
            if not anchor:
                continue

            href = (anchor.get('href') or '').strip()
            if not href:
                continue

            # Ignore "show all results" and search/navigation links
            classes = ' '.join(anchor.get('class') or [])
            if 'b-search__live_all' in classes:
                continue
            if '/search/' in href and 'do=search' in href:
                continue

            absolute = urljoin(client.host, href)
            if absolute in seen:
                continue

            title_node = anchor.select_one('.enty')
            title = _clean_title(
                title_node.get_text(' ', strip=True)
                if title_node
                else anchor.get_text(' ', strip=True)
            )

            if not title:
                continue

            full_text = _clean_title(anchor.get_text(' ', strip=True))
            year_match = re.search(r'\b((?:19|20)\d{2})\b', full_text)
            year = int(year_match.group(1)) if year_match else 0

            seen.add(absolute)

            rows.append(
                InlineItem(
                    absolute,
                    title,
                    InlineInfo(year, None, '', ''),
                    '',
                    client,
                )
            )

        return rows

    def _extract_full_search_items(html, client):
        soup = BeautifulSoup(html or '', 'html.parser')
        rows = []
        seen = set()

        for block in soup.select('.b-content__inline_item-link'):
            anchor = block.find('a', href=True)
            if not anchor:
                continue

            href = (anchor.get('href') or '').strip()
            if not href:
                continue

            absolute = urljoin(client.host, href)
            if absolute in seen:
                continue

            title = _clean_title(anchor.get_text(' ', strip=True))
            if not title:
                continue

            info_node = block.find('div')
            info_text = _clean_title(
                info_node.get_text(' ', strip=True)
                if info_node
                else ''
            )

            year_match = re.search(r'\b((?:19|20)\d{2})\b', info_text)
            year = int(year_match.group(1)) if year_match else 0

            parts = [x.strip() for x in info_text.split(',') if x.strip()]
            country = parts[1] if len(parts) > 1 else ''
            genre = ', '.join(parts[2:]) if len(parts) > 2 else ''

            seen.add(absolute)

            rows.append(
                InlineItem(
                    absolute,
                    title,
                    InlineInfo(year, None, country, genre),
                    '',
                    client,
                )
            )

        return rows

    async def _get_page_fixed(self, page=1, **kwargs):
        # First page: same live-search request used by current Online Mod.
        if page in (None, 1):
            live_url = self.client.host_join('engine/ajax/search.php')

            response = await self.client.get_response(
                'POST',
                live_url,
                data={'q': self.query},
                headers={
                    'Referer': self.client.host,
                    'Origin': self.client.host.rstrip('/'),
                    'X-Requested-With': 'XMLHttpRequest',
                },
            )

            print(
                '[hdrezka-premium] live-search '
                f'query={self.query!r} status={response.status_code} '
                f'url={response.url}'
            )

            live_rows = _extract_live_items(
                response.text,
                self.client
            )

            print(
                '[hdrezka-premium] live-search '
                f'results={len(live_rows)}'
            )

            if live_rows:
                return live_rows

        # Fallback to the ordinary search results page.
        page_num = 1 if page in (None, 1) else int(page)

        full_url = self.client.host_join(
            'search/?do=search&subaction=search'
        )

        response = await self.client.get_response(
            'GET',
            full_url,
            params={
                'q': self.query,
                'page': page_num,
            },
            headers={
                'Referer': self.client.host,
            },
        )

        print(
            '[hdrezka-premium] full-search '
            f'query={self.query!r} page={page_num} '
            f'status={response.status_code} url={response.url}'
        )

        rows = _extract_full_search_items(
            response.text,
            self.client
        )

        print(
            '[hdrezka-premium] full-search '
            f'results={len(rows)}'
        )

        return rows

    Search.get_page = _get_page_fixed

    print(
        '[hdrezka-premium] search patch v3 loaded '
        '(POST live-search + full-search fallback)'
    )

except Exception as exc:
    print(
        '[hdrezka-premium] search patch v3 failed:',
        repr(exc)
    )
