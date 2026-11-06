export function articleHeadings(content: string) {
  const seen = new Map<string, number>();
  return content.split(/\n\n+/).flatMap((block, blockIndex) => {
    const match = /^(#{2,3})\s+(.+)$/u.exec(block.trim());
    if (!match) return [];
    const title = match[2].replace(/[*`]/g, '');
    const folded = title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/ə/g,'e').replace(/ı/g,'i');
    const base = folded.replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') || 'bolme';
    const count = (seen.get(base) ?? 0) + 1; seen.set(base,count);
    return [{ title, id: count===1 ? base : `${base}-${count}`, level: match[1].length, blockIndex }];
  });
}
