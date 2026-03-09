import { z } from "zod";
import { colorFromSlug, slugifyCategoryName } from "./schema";

export const llmResponseSchema = z.object({
  categories: z.array(
    z.object({
      name: z.string(),
      description: z.string().optional(),
    }),
  ),
  assignments: z.array(
    z.object({
      id: z.string(),
      categoryName: z.string(),
      confidence: z.number().min(0).max(1),
      reason: z.string(),
      summary: z.string().optional(),
    }),
  ),
});

export type LlmClassificationResponse = z.infer<typeof llmResponseSchema>;

export function toCategoryRecords(response: LlmClassificationResponse) {
  return response.categories.map((category) => {
    const slug = slugifyCategoryName(category.name);
    return {
      slug,
      name: category.name,
      description: category.description,
      color: colorFromSlug(slug),
      source: "llm" as const,
    };
  });
}
