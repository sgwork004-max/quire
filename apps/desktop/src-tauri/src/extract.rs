//! Pulls a title and searchable plain text out of an HTML file without a full
//! parser. Good enough for search; never used for rendering.

const MAX_TEXT: usize = 40_000;

pub struct Extracted {
    pub title: Option<String>,
    pub text: String,
}

pub fn extract(html: &str) -> Extracted {
    // ASCII lowercasing keeps byte offsets identical, so indexes line up.
    let lower = html.to_ascii_lowercase();
    let title = between(html, &lower, "<title", "</title>")
        .map(|t| collapse(&decode_entities(t)))
        .filter(|t| !t.is_empty());
    let body_start = lower.find("<body").unwrap_or(0);
    Extracted { title, text: text_content(&html[body_start..], &lower[body_start..]) }
}

fn between<'a>(html: &'a str, lower: &str, open: &str, close: &str) -> Option<&'a str> {
    let start = lower.find(open)?;
    let content_start = start + lower[start..].find('>')? + 1;
    let end = content_start + lower[content_start..].find(close)?;
    Some(&html[content_start..end])
}

fn text_content(html: &str, lower: &str) -> String {
    let mut out = String::new();
    let mut i = 0;
    let bytes = html.as_bytes();
    while i < bytes.len() && out.len() < MAX_TEXT {
        if bytes[i] == b'<' {
            let rest = &lower[i..];
            let skip_to = if rest.starts_with("<!--") {
                rest.find("-->").map(|e| e + 3)
            } else if rest.starts_with("<script") {
                rest.find("</script>").map(|e| e + 9)
            } else if rest.starts_with("<style") {
                rest.find("</style>").map(|e| e + 8)
            } else if rest.starts_with("<svg") {
                rest.find("</svg>").map(|e| e + 6)
            } else {
                rest.find('>').map(|e| e + 1)
            };
            match skip_to {
                Some(n) => {
                    i += n;
                    out.push(' ');
                }
                None => break,
            }
        } else {
            let end = html[i..].find('<').map(|e| i + e).unwrap_or(html.len());
            out.push_str(&decode_entities(&html[i..end]));
            i = end;
        }
    }
    let mut text = collapse(&out);
    if text.len() > MAX_TEXT {
        let mut cut = MAX_TEXT;
        while !text.is_char_boundary(cut) {
            cut -= 1;
        }
        text.truncate(cut);
    }
    text
}

fn decode_entities(s: &str) -> String {
    if !s.contains('&') {
        return s.to_string();
    }
    s.replace("&nbsp;", " ")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&rsquo;", "’")
        .replace("&middot;", "·")
        .replace("&amp;", "&")
}

fn collapse(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pulls_title_and_visible_text() {
        let e = extract(
            "<html><head><title> Q3 &amp; Q4 </title><style>p{}</style></head>\
             <body><h1>Revenue</h1><!-- note --><script>let x = '<p>';</script><p>Up&nbsp;12%</p></body></html>",
        );
        assert_eq!(e.title.as_deref(), Some("Q3 & Q4"));
        assert_eq!(e.text, "Revenue Up 12%");
    }

    #[test]
    fn handles_missing_title_and_unicode() {
        let e = extract("<p>₹4.2 Cr — growth</p>");
        assert_eq!(e.title, None);
        assert_eq!(e.text, "₹4.2 Cr — growth");
    }
}
