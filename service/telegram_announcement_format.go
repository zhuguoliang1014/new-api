package service

import (
	"bytes"
	"fmt"
	"html"
	"net/url"
	"strconv"
	"strings"

	"github.com/yuin/goldmark"
	nethtml "golang.org/x/net/html"
)

// Convert CommonMark into Telegram's small HTML subset. The intermediate HTML
// never leaves this function: tags, attributes and URL schemes are allowlisted.
func renderAnnouncementBody(body, format string) (string, string, error) {
	if format == "" || format == "plain" {
		return html.EscapeString(body), body, nil
	}
	if format != "markdown" || len(body) > 65536 {
		return "", "", ErrAnnouncementInvalid
	}
	var converted bytes.Buffer
	markdown := goldmark.New()
	if err := markdown.Convert([]byte(body), &converted); err != nil {
		return "", "", ErrAnnouncementInvalid
	}
	doc, err := nethtml.Parse(&converted)
	if err != nil {
		return "", "", ErrAnnouncementInvalid
	}
	renderer := announcementBodyRenderer{}
	if err := renderer.render(doc, 0, false, false); err != nil {
		return "", "", err
	}
	rendered := strings.TrimSpace(renderer.html.String())
	// Count exactly the text Telegram sees, including whitespace inside code.
	var visible strings.Builder
	tokenizer := nethtml.NewTokenizer(strings.NewReader(rendered))
	for {
		kind := tokenizer.Next()
		if kind == nethtml.ErrorToken {
			break
		}
		if kind == nethtml.TextToken {
			visible.Write(tokenizer.Text())
		}
	}
	return rendered, visible.String(), nil
}

type announcementBodyRenderer struct {
	html strings.Builder
}

func (r *announcementBodyRenderer) write(value string) {
	r.html.WriteString(html.EscapeString(value))
}

func (r *announcementBodyRenderer) render(node *nethtml.Node, depth int, inQuote bool, inInline bool) error {
	if depth > 64 {
		return ErrAnnouncementInvalid
	}
	if node.Type == nethtml.TextNode {
		// HTML renderer newlines between blocks are structural, not message text.
		if node.Parent != nil && (node.Parent.Data == "body" || node.Parent.Data == "ul" || node.Parent.Data == "ol" || node.Parent.Data == "blockquote") && strings.TrimSpace(node.Data) == "" {
			return nil
		}
		r.write(node.Data)
		return nil
	}
	if node.Type != nethtml.ElementNode && node.Type != nethtml.DocumentNode {
		return nil
	}
	tag, ending := "", ""
	switch node.Data {
	case "script", "style", "iframe", "object", "svg", "math":
		return nil
	case "strong", "b":
		tag = "b"
	case "em", "i":
		tag = "i"
	case "del", "s":
		tag = "s"
	case "code":
		tag = node.Data
	case "pre":
		tag, ending = "pre", "\n\n"
	case "blockquote":
		if !inQuote {
			tag = "blockquote"
		}
		inQuote = true
		ending = "\n\n"
	case "p":
		ending = "\n\n"
		if node.Parent != nil && node.Parent.Data == "li" {
			ending = "\n"
		}
	case "h1", "h2", "h3", "h4", "h5", "h6":
		tag, ending = "b", "\n\n"
	case "br":
		r.write("\n")
		return nil
	case "li":
		prefix := "• "
		if node.Parent != nil && node.Parent.Data == "ol" {
			index := 1
			for _, attr := range node.Parent.Attr {
				if attr.Key == "start" {
					if start, err := strconv.Atoi(attr.Val); err == nil {
						index = start
					}
				}
			}
			for previous := node.PrevSibling; previous != nil; previous = previous.PrevSibling {
				if previous.Data == "li" {
					index++
				}
			}
			prefix = fmt.Sprintf("%d. ", index)
		}
		r.write(prefix)
		ending = "\n"
	case "ul", "ol":
		ending = "\n\n"
	case "a":
		for _, attr := range node.Attr {
			if attr.Key != "href" {
				continue
			}
			u, err := url.Parse(attr.Val)
			if err == nil && (u.Scheme == "https" || u.Scheme == "http") && u.Hostname() != "" && u.User == nil && !strings.ContainsAny(attr.Val, "\r\n\t") {
				r.html.WriteString(`<a href="` + html.EscapeString(attr.Val) + `">`)
				tag = "a"
			}
		}
	case "img":
		for _, attr := range node.Attr {
			if attr.Key == "alt" {
				r.write(attr.Val)
			}
		}
		return nil
	}
	if (tag == "code" || tag == "pre") && (inInline || inQuote) {
		tag = ""
	}
	childInline := inInline || tag == "b" || tag == "i" || tag == "s" || tag == "a"
	if tag != "" && tag != "a" {
		r.html.WriteString("<" + tag + ">")
	}
	for child := node.FirstChild; child != nil; child = child.NextSibling {
		if err := r.render(child, depth+1, inQuote, childInline); err != nil {
			return err
		}
	}
	if node.Data == "blockquote" || node.Data == "ul" || node.Data == "ol" || node.Data == "li" {
		rendered := strings.TrimRight(r.html.String(), "\n")
		r.html.Reset()
		r.html.WriteString(rendered)
	}
	if tag != "" {
		r.html.WriteString("</" + tag + ">")
	}
	if ending != "" {
		r.write(ending)
	}
	return nil
}
