import { FinancialDetail } from "@/components/financial-detail";
export const dynamic = "force-dynamic";
export const metadata = { title: "Categorie · Ember Finance" };
export default function CategoryPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ month?: string | string[]; page?: string | string[] }> }) {
  return <FinancialDetail kind="categories" {...props} />;
}
