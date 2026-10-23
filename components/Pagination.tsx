import { Button, Flex } from 'antd';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useRouter } from 'next/router';

import { PAGE_QUERY_PARAM } from 'constants/index';

type PaginationProps = {
  hasMore: boolean;
};

export const Pagination = ({ hasMore }: PaginationProps) => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pageParam = searchParams.get(PAGE_QUERY_PARAM);
  const page = pageParam ? +pageParam : 1;

  const handleNextPage = (page: number) => {
    if (page <= 0) return;

    const params = new URLSearchParams(searchParams);

    if (page > 1) params.set(PAGE_QUERY_PARAM, page.toString());
    else params.delete(PAGE_QUERY_PARAM);

    const newParams = params.toString();
    // Shallow, so a page change is not counted as another pageview
    router.replace(`${newParams ? `?${newParams}` : ''}`, undefined, { shallow: true });

    const layoutDiv = document.querySelector('.ant-layout');
    layoutDiv?.scrollTo({ top: 0 });
  };

  return (
    <Flex gap={8} justify="end" className="full-width">
      <Button
        type="text"
        size="large"
        onClick={() => handleNextPage(page - 1)}
        disabled={page === 1}
      >
        <ChevronLeft /> Prev
      </Button>
      <Button type="text" size="large" onClick={() => handleNextPage(page + 1)} disabled={!hasMore}>
        Next <ChevronRight />
      </Button>
    </Flex>
  );
};
