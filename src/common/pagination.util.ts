import { PaginationMetaDto } from './dto/pagination-meta.dto';

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;

export function paginationSkipTake(
  page: number | undefined,
  pageSize: number | undefined,
): { skip: number; take: number; page: number; pageSize: number } {
  const resolvedPage = page && page > 0 ? page : DEFAULT_PAGE;
  const resolvedPageSize = pageSize && pageSize > 0 ? pageSize : DEFAULT_PAGE_SIZE;

  return {
    skip: (resolvedPage - 1) * resolvedPageSize,
    take: resolvedPageSize,
    page: resolvedPage,
    pageSize: resolvedPageSize,
  };
}

export function buildPaginationMeta(
  total: number,
  page: number,
  pageSize: number,
): PaginationMetaDto {
  return {
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}
