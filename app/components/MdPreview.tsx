import * as React from 'react';
import MarkdownIt from 'markdown-it';

export default function({ content }) {
  const md = MarkdownIt();
  try {
    const html = md.render(content);
    return (
      <div
        className="markdown-body"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  } catch (e) {
    return <>{e}</>;
  }
}
