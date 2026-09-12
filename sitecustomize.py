import re

# Compatibility patch for hdrezka==5.2.0 search parsing.
# Current Rezka result rows may contain more than 3 comma-separated fields:
# year, country, several genres.
try:
    from hdrezka.post.page import Page
    from hdrezka.post.inline import InlineItem, InlineInfo

    def _parse_items_fixed(self, soup):
        result = []

        for item in soup.find_all(class_='b-content__inline_item'):
            link = item.find(class_='b-content__inline_item-link')

            if not link:
                continue

            anchor = link.find('a', href=True)

            if not anchor:
                continue

            info_node = link.find('div')
            info_text = (
                info_node.get_text(' ', strip=True)
                if info_node
                else ''
            )

            parts = [
                part.strip()
                for part in info_text.split(',')
                if part.strip()
            ]

            years = parts[0] if parts else ''
            country = parts[1] if len(parts) > 1 else ''
            genre = ', '.join(parts[2:]) if len(parts) > 2 else ''

            try:
                info = self._inline_info(
                    years,
                    country,
                    genre
                )
            except Exception:
                match = re.search(
                    r'\b((?:19|20)\d{2})\b',
                    info_text
                )

                year = int(match.group(1)) if match else 0

                info = InlineInfo(
                    year,
                    None,
                    country,
                    genre
                )

            cover = item.find(
                class_='b-content__inline_item-cover'
            )

            image = cover.find('img') if cover else None
            poster = image.get('src', '') if image else ''

            result.append(
                InlineItem(
                    anchor['href'],
                    anchor.get_text(' ', strip=True),
                    info,
                    poster,
                    self.client
                )
            )

        return result

    Page._parse_items = _parse_items_fixed

    print(
        '[hdrezka-premium] search parser compatibility patch loaded'
    )

except Exception as exc:
    print(
        '[hdrezka-premium] failed to load search parser patch:',
        exc
    )
