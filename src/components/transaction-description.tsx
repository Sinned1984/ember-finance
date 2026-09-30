import { descriptionPreview } from "@/lib/presentation";

export function TransactionDescription({ text }: { text: string }) {
  const preview = descriptionPreview(text);
  if (preview === text && !/[\r\n]/.test(text)) return <strong className="description-text">{text}</strong>;
  return <details className="transaction-details"><summary><strong className="description-preview">{preview}</strong><span className="description-open">Volledige omschrijving</span><span className="description-close">Omschrijving inklappen</span></summary><p>{text}</p></details>;
}
