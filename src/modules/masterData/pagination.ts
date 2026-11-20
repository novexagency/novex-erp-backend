export type PageQuery = {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
  includeArchived?: boolean;
};

export function parsePage(query: Record<string, unknown>): {
  page: number;
  pageSize: number;
  skip: number;
  search?: string;
  status?: string;
  includeArchived: boolean;
} {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize,
    search: typeof query.search === "string" ? query.search.trim() : undefined,
    status: typeof query.status === "string" ? query.status : undefined,
    includeArchived: query.includeArchived === "true" || query.includeArchived === true,
  };
}

export function pageResult<T>(items: T[], total: number, page: number, pageSize: number) {
  return {
    items,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  };
}
