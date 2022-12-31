import { MutableRefObject, useCallback, useMemo } from 'react';
import type {
  BodyScrollEvent,
  CellContextMenuEvent,
  ColDef,
  GridReadyEvent,
  IDatasource,
  PaginationChangedEvent,
  RowDoubleClickedEvent,
} from '@ag-grid-community/core';
import type { AgGridReact as AgGridReactType } from '@ag-grid-community/react/lib/agGridReact';
import { Stack } from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '/@/renderer/api';
import { queryKeys } from '/@/renderer/api/query-keys';
import {
  getColumnDefs,
  TablePagination,
  VirtualGridAutoSizerContainer,
  VirtualTable,
} from '/@/renderer/components';
import { useSongList } from '/@/renderer/features/songs/queries/song-list-query';
import {
  useCurrentServer,
  useSetSongTable,
  useSetSongTablePagination,
  useSongListStore,
  useSongTablePagination,
} from '/@/renderer/store';
import { LibraryItem, ListDisplayType } from '/@/renderer/types';
import { AnimatePresence } from 'framer-motion';
import debounce from 'lodash/debounce';
import { openContextMenu } from '/@/renderer/features/context-menu';
import { SONG_CONTEXT_MENU_ITEMS } from '/@/renderer/features/context-menu/context-menu-items';
import sortBy from 'lodash/sortBy';
import { useHandlePlayQueueAdd } from '/@/renderer/features/player/hooks/use-handle-playqueue-add';
import { usePlayButtonBehavior } from '/@/renderer/store/settings.store';
import { QueueSong } from '/@/renderer/api/types';

interface SongListContentProps {
  tableRef: MutableRefObject<AgGridReactType | null>;
}

export const SongListContent = ({ tableRef }: SongListContentProps) => {
  const queryClient = useQueryClient();
  const server = useCurrentServer();
  const page = useSongListStore();

  const pagination = useSongTablePagination();
  const setPagination = useSetSongTablePagination();
  const setTable = useSetSongTable();
  const handlePlayQueueAdd = useHandlePlayQueueAdd();
  const playButtonBehavior = usePlayButtonBehavior();

  const isPaginationEnabled = page.display === ListDisplayType.TABLE_PAGINATED;

  const checkSongList = useSongList({
    limit: 1,
    startIndex: 0,
    ...page.filter,
  });

  const columnDefs: ColDef[] = useMemo(
    () => getColumnDefs(page.table.columns),
    [page.table.columns],
  );

  const defaultColumnDefs: ColDef = useMemo(() => {
    return {
      lockPinned: true,
      lockVisible: true,
      resizable: true,
    };
  }, []);

  const onGridReady = useCallback(
    (params: GridReadyEvent) => {
      const dataSource: IDatasource = {
        getRows: async (params) => {
          const limit = params.endRow - params.startRow;
          const startIndex = params.startRow;

          const queryKey = queryKeys.songs.list(server?.id || '', {
            limit,
            startIndex,
            ...page.filter,
          });

          const songsRes = await queryClient.fetchQuery(queryKey, async ({ signal }) =>
            api.controller.getSongList({
              query: {
                limit,
                startIndex,
                ...page.filter,
              },
              server,
              signal,
            }),
          );

          const songs = api.normalize.songList(songsRes, server);
          params.successCallback(songs?.items || [], songsRes?.totalRecordCount);
        },
        rowCount: undefined,
      };
      params.api.setDatasource(dataSource);
      params.api.ensureIndexVisible(page.table.scrollOffset, 'top');
    },
    [page.filter, page.table.scrollOffset, queryClient, server],
  );

  const onPaginationChanged = useCallback(
    (event: PaginationChangedEvent) => {
      if (!isPaginationEnabled || !event.api) return;

      // Scroll to top of page on pagination change
      const currentPageStartIndex = pagination.currentPage * pagination.itemsPerPage;
      event.api?.ensureIndexVisible(currentPageStartIndex, 'top');

      setPagination({
        itemsPerPage: event.api.paginationGetPageSize(),
        totalItems: event.api.paginationGetRowCount(),
        totalPages: event.api.paginationGetTotalPages() + 1,
      });
    },
    [isPaginationEnabled, pagination.currentPage, pagination.itemsPerPage, setPagination],
  );

  const handleGridSizeChange = () => {
    if (page.table.autoFit) {
      tableRef?.current?.api.sizeColumnsToFit();
    }
  };

  const handleColumnChange = useCallback(() => {
    const { columnApi } = tableRef?.current || {};
    const columnsOrder = columnApi?.getAllGridColumns();

    if (!columnsOrder) return;

    const columnsInSettings = page.table.columns;
    const updatedColumns = [];
    for (const column of columnsOrder) {
      const columnInSettings = columnsInSettings.find((c) => c.column === column.getColDef().colId);

      if (columnInSettings) {
        updatedColumns.push({
          ...columnInSettings,
          ...(!page.table.autoFit && {
            width: column.getActualWidth(),
          }),
        });
      }
    }

    setTable({ columns: updatedColumns });
  }, [page.table.autoFit, page.table.columns, setTable, tableRef]);

  const debouncedColumnChange = debounce(handleColumnChange, 200);

  const handleScroll = (e: BodyScrollEvent) => {
    const scrollOffset = Number((e.top / page.table.rowHeight).toFixed(0));
    setTable({ scrollOffset });
  };

  const handleContextMenu = (e: CellContextMenuEvent) => {
    if (!e.event) return;
    const clickEvent = e.event as MouseEvent;
    clickEvent.preventDefault();

    const selectedNodes = e.api.getSelectedNodes();
    const selectedIds = selectedNodes.map((node) => node.data.id);
    let selectedRows = sortBy(selectedNodes, ['rowIndex']).map((node) => node.data);

    if (!selectedIds.includes(e.data.id)) {
      e.api.deselectAll();
      e.node.setSelected(true);
      selectedRows = [e.data];
    }

    openContextMenu({
      data: selectedRows,
      menuItems: SONG_CONTEXT_MENU_ITEMS,
      type: LibraryItem.SONG,
      xPos: clickEvent.clientX,
      yPos: clickEvent.clientY,
    });
  };

  const handleRowDoubleClick = (e: RowDoubleClickedEvent<QueueSong>) => {
    if (!e.data) return;
    handlePlayQueueAdd({
      byData: [e.data],
      play: playButtonBehavior,
    });
  };

  return (
    <Stack
      h="100%"
      spacing={0}
    >
      <VirtualGridAutoSizerContainer>
        <VirtualTable
          // https://github.com/ag-grid/ag-grid/issues/5284
          // Key is used to force remount of table when display, rowHeight, or server changes
          key={`table-${page.display}-${page.table.rowHeight}-${server?.id}`}
          ref={tableRef}
          alwaysShowHorizontalScroll
          animateRows
          maintainColumnOrder
          suppressCopyRowsToClipboard
          suppressMoveWhenRowDragging
          suppressPaginationPanel
          suppressRowDrag
          suppressScrollOnNewData
          blockLoadDebounceMillis={200}
          cacheBlockSize={500}
          cacheOverflowSize={1}
          columnDefs={columnDefs}
          defaultColDef={defaultColumnDefs}
          enableCellChangeFlash={false}
          getRowId={(data) => data.data.id}
          infiniteInitialRowCount={checkSongList.data?.totalRecordCount || 100}
          pagination={isPaginationEnabled}
          paginationAutoPageSize={isPaginationEnabled}
          paginationPageSize={page.table.pagination.itemsPerPage || 100}
          rowBuffer={20}
          rowHeight={page.table.rowHeight || 40}
          rowModelType="infinite"
          rowSelection="multiple"
          onBodyScrollEnd={handleScroll}
          onCellContextMenu={handleContextMenu}
          onColumnMoved={handleColumnChange}
          onColumnResized={debouncedColumnChange}
          onGridReady={onGridReady}
          onGridSizeChanged={handleGridSizeChange}
          onPaginationChanged={onPaginationChanged}
          onRowDoubleClicked={handleRowDoubleClick}
        />
      </VirtualGridAutoSizerContainer>
      <AnimatePresence
        presenceAffectsLayout
        initial={false}
        mode="wait"
      >
        {page.display === ListDisplayType.TABLE_PAGINATED && (
          <TablePagination
            pagination={pagination}
            setPagination={setPagination}
            tableRef={tableRef}
          />
        )}
      </AnimatePresence>
    </Stack>
  );
};
