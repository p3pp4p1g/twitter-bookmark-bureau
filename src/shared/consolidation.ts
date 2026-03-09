import {
  colorFromSlug,
  slugifyCategoryName,
  type BookmarkRecord,
  type CategoryRecord,
} from "./schema";

type CanonicalCategoryDefinition = {
  name: string;
  description: string;
};

const CATEGORY_DEFINITIONS = {
  "girl-ai-image-generation-prompts": {
    name: "Girl AI Image Generation Prompts",
    description:
      "Detailed prompts for generating female characters, women, or feminine models with AI image tools.",
  },
  "ai-image-generation-prompts": {
    name: "AI Image Generation Prompts",
    description:
      "Detailed prompts and techniques for generating realistic or stylized images with AI.",
  },
  "ai-image-generation": {
    name: "AI Image Generation",
    description:
      "Tools, showcases, and techniques for generating still images with artificial intelligence.",
  },
  "ai-video-generation-prompts": {
    name: "AI Video Generation Prompts",
    description:
      "Detailed prompts and scene instructions for generating videos or animations with AI.",
  },
  "ai-video-generation": {
    name: "AI Video Generation",
    description:
      "Tools, workflows, and showcases for AI-generated video, animation, and motion content.",
  },
  "ai-agents-automation": {
    name: "AI Agents & Automation",
    description:
      "Discussions and resources related to AI agents, orchestration, and automation workflows.",
  },
  "ai-content-creation-tools": {
    name: "AI Content Creation Tools",
    description:
      "General-purpose AI tools and platforms for text, code, image, and multimedia creation.",
  },
  "ai-development-infrastructure": {
    name: "AI Development & Infrastructure",
    description:
      "Technical discussions on AI models, APIs, deployment, infrastructure, and developer tooling.",
  },
  "ai-workflow-strategy": {
    name: "AI Workflow & Strategy",
    description:
      "Practical strategies for prompt engineering, production workflows, and effective AI usage.",
  },
  "saas-business-strategy": {
    name: "SaaS & Business Strategy",
    description:
      "Business model, product, and monetization discussions around SaaS and AI-enabled products.",
  },
  "marketing-growth": {
    name: "Marketing & Growth",
    description:
      "Acquisition, positioning, marketing tactics, and growth strategy for products and content.",
  },
  "design-development-workflow": {
    name: "Design & Development Workflow",
    description:
      "Design systems, UI inspiration, product design, and development workflow references.",
  },
  "ai-society": {
    name: "AI & Society",
    description:
      "Economic, ethical, and cultural discussions about how AI affects society and work.",
  },
  "web-security": {
    name: "Web Security",
    description:
      "Security research, bug bounty material, vulnerabilities, and defensive web practices.",
  },
  "finance-investment": {
    name: "Finance & Investment",
    description:
      "Personal finance, investing, valuation, trading, and broader financial market references.",
  },
  "business-strategy": {
    name: "Business & Strategy",
    description:
      "Business models, strategic thinking, positioning, and commercial decision-making.",
  },
  "cooking-food": {
    name: "Cooking & Food",
    description:
      "Recipes, cooking ideas, food culture, and culinary references.",
  },
  "education-personal-development": {
    name: "Education & Personal Development",
    description:
      "Learning resources, books, productivity, career growth, and personal development material.",
  },
  "programming-technology": {
    name: "Programming & Technology",
    description:
      "Programming, software development, and broader technology references.",
  },
  "web3-crypto": {
    name: "Web3 & Crypto",
    description:
      "Blockchain, crypto, and adjacent decentralized technology topics.",
  },
  "health-wellness": {
    name: "Health & Wellness",
    description:
      "Health, wellness, and self-care references.",
  },
  "needs-review": {
    name: "Needs Review",
    description:
      "Bookmark that could not be categorized confidently and should be reviewed manually.",
  },
} satisfies Record<string, CanonicalCategoryDefinition>;

const FEMALE_IMAGE_TERMS = [
  /\bgirl\b/i,
  /\bgirls\b/i,
  /\bwoman\b/i,
  /\bwomen\b/i,
  /\bfemale\b/i,
  /\blady\b/i,
  /\bladies\b/i,
  /\bmulher\b/i,
  /\bmulheres\b/i,
  /\bgarota\b/i,
  /\bgarotas\b/i,
  /\bmenina\b/i,
  /\bmeninas\b/i,
  /\banime girl\b/i,
  /\bfemale character\b/i,
  /\bwoman portrait\b/i,
  /\bgirl portrait\b/i,
  /\bbeautiful woman\b/i,
  /\byoung woman\b/i,
  /\bfeminine\b/i,
  /\bwaifu\b/i,
];

const IMAGE_HINTS = [
  /\bimage\b/i,
  /\bphoto\b/i,
  /\bportrait\b/i,
  /\brender\b/i,
  /\billustration\b/i,
  /\bcharacter\b/i,
];

const VIDEO_HINTS = [
  /\bvideo\b/i,
  /\banimation\b/i,
  /\bscene\b/i,
  /\bsequence\b/i,
  /\bmotion\b/i,
  /\bstoryboard\b/i,
];

const PROMPT_HINTS = [
  /\bprompt\b/i,
  /\bnegative_prompt\b/i,
  /"subject"\s*:/i,
  /"constraints"\s*:/i,
  /\buse my uploaded photo\b/i,
  /\bpreserve the original camera framing\b/i,
];

const PROMPT_IMAGE_SLUGS = new Set([
  "ai-image-generation-prompts",
  "girl-ai-image-generation-prompts",
  "ai-image-character-consistency",
  "ai-image-video-consistency",
  "ai-content-creation-strategy",
]);

const IMAGE_SLUGS = new Set([
  "ai-image-generation",
  "ai-image-video-generation",
  "ai-animation-style",
]);

const PROMPT_VIDEO_SLUGS = new Set([
  "ai-video-generation-prompts",
]);

const VIDEO_SLUGS = new Set([
  "ai-video-generation",
  "ai-animation-video",
  "ai-video-animation",
  "ai-video-animation-tools",
  "ai-animation-motion-graphics",
]);

const ALIAS_TO_CANONICAL = new Map<string, string>([
  ["ai-agents-automation", "ai-agents-automation"],
  ["ai-content-creation-tools", "ai-content-creation-tools"],
  ["ai-development-infrastructure", "ai-development-infrastructure"],
  ["ai-development-learning", "ai-development-infrastructure"],
  ["ai-development-workflow", "ai-development-infrastructure"],
  ["ai-development-understanding", "ai-development-infrastructure"],
  ["ai-workflow-strategy", "ai-workflow-strategy"],
  ["ai-content-workflow", "ai-workflow-strategy"],
  ["saas-business-strategy", "saas-business-strategy"],
  ["marketing-growth", "marketing-growth"],
  ["ai-business-marketing", "marketing-growth"],
  ["design-development-workflow", "design-development-workflow"],
  ["design-inspiration", "design-development-workflow"],
  ["design-creative-inspiration", "design-development-workflow"],
  ["ai-society", "ai-society"],
  ["web-security", "web-security"],
  ["finance-investment", "finance-investment"],
  ["investimentos-e-financas-pessoais", "finance-investment"],
  ["mercado-financeiro", "finance-investment"],
  ["finance-economics", "finance-investment"],
  ["financas-pessoais-e-investimentos", "finance-investment"],
  ["business-finance", "finance-investment"],
  ["investimentos-e-financas", "finance-investment"],
  ["finance-business-valuation", "finance-investment"],
  ["finance-trading", "finance-investment"],
  ["business-strategy", "business-strategy"],
  ["social-media-strategy", "marketing-growth"],
  ["cooking-recipes", "cooking-food"],
  ["culinaria-e-receitas", "cooking-food"],
  ["food-culture", "cooking-food"],
  ["food-recipes", "cooking-food"],
  ["education-learning", "education-personal-development"],
  ["education-learning-resources", "education-personal-development"],
  ["career-education", "education-personal-development"],
  ["book-recommendations", "education-personal-development"],
  ["personal-development-books", "education-personal-development"],
  ["personal-development-productivity", "education-personal-development"],
  ["programacao-e-desenvolvimento", "programming-technology"],
  ["programming-development", "programming-technology"],
  ["technology-trends", "programming-technology"],
  ["web3-blockchain", "web3-crypto"],
  ["web3-crypto", "web3-crypto"],
  ["health-wellness", "health-wellness"],
  ["needs-review", "needs-review"],
]);

export type ConsolidationResult = {
  categories: CategoryRecord[];
  assignments: BookmarkRecord[];
  changedCount: number;
};

function makeCategory(slug: string): CategoryRecord {
  const definition = CATEGORY_DEFINITIONS[slug as keyof typeof CATEGORY_DEFINITIONS];
  if (!definition) {
    throw new Error(`Missing canonical category definition for slug: ${slug}`);
  }

  return {
    slug,
    name: definition.name,
    description: definition.description,
    color: colorFromSlug(slug),
    source: "llm",
  };
}

function getEffectiveCategorySlug(bookmark: BookmarkRecord): string | undefined {
  return (
    bookmark.manualCategorySlug ??
    bookmark.categorySlug ??
    (bookmark.categoryName ? slugifyCategoryName(bookmark.categoryName) : undefined)
  );
}

function getBookmarkTextForRules(bookmark: BookmarkRecord): string {
  return [
    bookmark.text,
    bookmark.summary,
    bookmark.categoryReason,
    bookmark.links.join(" "),
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function isPromptLike(bookmark: BookmarkRecord): boolean {
  const text = getBookmarkTextForRules(bookmark);
  return (
    matchesAny(text, PROMPT_HINTS) ||
    text.length > 700 ||
    text.includes("{") ||
    text.includes("json")
  );
}

function isImageLike(bookmark: BookmarkRecord): boolean {
  const text = getBookmarkTextForRules(bookmark);
  return matchesAny(text, IMAGE_HINTS);
}

function isVideoLike(bookmark: BookmarkRecord): boolean {
  const text = getBookmarkTextForRules(bookmark);
  return (
    matchesAny(text, VIDEO_HINTS) ||
    bookmark.media.some((item) => item.type === "video" || item.type === "animated_gif")
  );
}

function isFemaleFocusedImagePrompt(bookmark: BookmarkRecord): boolean {
  const text = getBookmarkTextForRules(bookmark);
  return matchesAny(text, FEMALE_IMAGE_TERMS);
}

function resolveCanonicalSlug(bookmark: BookmarkRecord): string | undefined {
  const currentSlug = getEffectiveCategorySlug(bookmark);
  if (!currentSlug) {
    return undefined;
  }

  if (PROMPT_IMAGE_SLUGS.has(currentSlug) || (IMAGE_SLUGS.has(currentSlug) && isPromptLike(bookmark))) {
    return isFemaleFocusedImagePrompt(bookmark)
      ? "girl-ai-image-generation-prompts"
      : "ai-image-generation-prompts";
  }

  if (IMAGE_SLUGS.has(currentSlug)) {
    return "ai-image-generation";
  }

  if (PROMPT_VIDEO_SLUGS.has(currentSlug) || (VIDEO_SLUGS.has(currentSlug) && isPromptLike(bookmark))) {
    return "ai-video-generation-prompts";
  }

  if (VIDEO_SLUGS.has(currentSlug) || (isVideoLike(bookmark) && currentSlug.startsWith("ai-video"))) {
    return "ai-video-generation";
  }

  if (currentSlug === "ai-image-video-generation") {
    return isPromptLike(bookmark) || isImageLike(bookmark)
      ? isFemaleFocusedImagePrompt(bookmark)
        ? "girl-ai-image-generation-prompts"
        : "ai-image-generation-prompts"
      : "ai-image-generation";
  }

  const alias = ALIAS_TO_CANONICAL.get(currentSlug);
  if (alias) {
    return alias;
  }

  if (currentSlug.includes("image") && isPromptLike(bookmark)) {
    return isFemaleFocusedImagePrompt(bookmark)
      ? "girl-ai-image-generation-prompts"
      : "ai-image-generation-prompts";
  }

  if (currentSlug.includes("image")) {
    return "ai-image-generation";
  }

  if (currentSlug.includes("video") || currentSlug.includes("animation")) {
    return isPromptLike(bookmark) ? "ai-video-generation-prompts" : "ai-video-generation";
  }

  return currentSlug in CATEGORY_DEFINITIONS ? currentSlug : undefined;
}

function mergeConsolidationReason(reason: string | undefined, canonicalName: string): string | undefined {
  if (!reason) {
    return reason;
  }

  const cleaned = reason.replace(/\s*Consolidated into .+?\.$/i, "").trim();
  return `${cleaned} Consolidated into ${canonicalName}.`;
}

export function consolidateClassification(
  assignments: BookmarkRecord[],
  incomingCategories: CategoryRecord[],
): ConsolidationResult {
  const categoryMap = new Map<string, CategoryRecord>();
  let changedCount = 0;

  for (const category of incomingCategories) {
    categoryMap.set(category.slug, category);
  }

  const consolidatedAssignments = assignments.map((bookmark) => {
    if (bookmark.manualCategorySlug && !ALIAS_TO_CANONICAL.has(bookmark.manualCategorySlug)) {
      return bookmark;
    }

    const canonicalSlug = resolveCanonicalSlug(bookmark);
    if (!canonicalSlug) {
      return bookmark;
    }

    const canonicalCategory = makeCategory(canonicalSlug);
    categoryMap.set(canonicalSlug, canonicalCategory);

    const effectiveSlug = bookmark.manualCategorySlug ?? bookmark.categorySlug;
    const sameCategory =
      effectiveSlug === canonicalCategory.slug && bookmark.categoryName === canonicalCategory.name;

    if (sameCategory) {
      return bookmark;
    }

    changedCount += 1;

    return {
      ...bookmark,
      categorySlug: bookmark.manualCategorySlug ? bookmark.categorySlug : canonicalCategory.slug,
      categoryName: canonicalCategory.name,
      manualCategorySlug: bookmark.manualCategorySlug ? canonicalCategory.slug : bookmark.manualCategorySlug,
      categoryReason: mergeConsolidationReason(bookmark.categoryReason, canonicalCategory.name),
      updatedAt: new Date().toISOString(),
    };
  });

  return {
    categories: [...categoryMap.values()]
      .filter((category) => category.slug in CATEGORY_DEFINITIONS)
      .map((category) =>
        category.slug in CATEGORY_DEFINITIONS ? makeCategory(category.slug) : category,
      ),
    assignments: consolidatedAssignments,
    changedCount,
  };
}

export function getCanonicalCategories(): CategoryRecord[] {
  return Object.keys(CATEGORY_DEFINITIONS).map((slug) => makeCategory(slug));
}
