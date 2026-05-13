export interface SrsSection {
  id: string;
  label: string;
  children?: SrsSection[];
}

export const SRS_SECTIONS: SrsSection[] = [
  {
    id: "1",
    label: "Introduction",
    children: [
      { id: "1.1", label: "Document Purpose" },
      { id: "1.2", label: "Product Scope" },
      { id: "1.3", label: "Definitions, Acronyms, and Abbreviations" },
      { id: "1.4", label: "References" },
      { id: "1.5", label: "Document Overview" },
    ],
  },
  {
    id: "2",
    label: "Product Overview",
    children: [
      { id: "2.1", label: "Product Perspective" },
      { id: "2.2", label: "Product Functions" },
      { id: "2.3", label: "Product Constraints" },
      { id: "2.4", label: "User Characteristics" },
      { id: "2.5", label: "Assumptions and Dependencies" },
      { id: "2.6", label: "Apportioning of Requirements" },
    ],
  },
  {
    id: "3",
    label: "Requirements",
    children: [
      { id: "3.1", label: "External Interfaces" },
      { id: "3.2", label: "Functional" },
      { id: "3.3", label: "Quality of Service" },
      { id: "3.4", label: "Compliance" },
      { id: "3.5", label: "Design and Implementation" },
      { id: "3.6", label: "AI/ML" },
    ],
  },
  { id: "4", label: "Verification" },
  { id: "5", label: "Appendixes" },
];

export function getLeafIds(sections: SrsSection[]): string[] {
  return sections.flatMap((s) =>
    s.children ? getLeafIds(s.children) : [s.id]
  );
}

export function getSectionLeafIds(section: SrsSection): string[] {
  return section.children ? getLeafIds(section.children) : [section.id];
}

export const ALL_LEAF_IDS = getLeafIds(SRS_SECTIONS);

export function getSectionById(id: string): SrsSection | undefined {
  for (const section of SRS_SECTIONS) {
    if (section.id === id) { return section; }
    if (section.children) {
      const found = section.children.find((c) => c.id === id);
      if (found) { return found; }
    }
  }
  return undefined;
}
