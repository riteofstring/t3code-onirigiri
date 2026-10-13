import type { OnirigiriLayout, WorkspaceScene } from "@riteofstring/onirigiri";

export function keepPaneSizes(layout: OnirigiriLayout, current: WorkspaceScene): OnirigiriLayout {
  const previousByPane = new Map(
    current.columns.flatMap((column) =>
      column.cells.map((cell) => [cell.paneId, { column, cell }] as const),
    ),
  );
  return {
    ...layout,
    columns: layout.columns.map((column) => {
      const previous = column.cells
        .map((cell) => previousByPane.get(cell.paneId)?.column)
        .find((match) => match !== undefined);
      if (!previous) return column;
      const { widthOverride, previousProportionWidth } = previous;
      return {
        ...column,
        cells: column.cells.map((cell) => {
          const prior = previousByPane.get(cell.paneId)?.cell;
          return prior
            ? {
                ...cell,
                weight: prior.weight,
                ...(prior.heightPx === undefined ? {} : { heightPx: prior.heightPx }),
              }
            : cell;
        }),
        idealWidthSpec: previous.idealWidthSpec,
        widthSpec: previous.widthSpec,
        ...(widthOverride === undefined ? {} : { widthOverride }),
        ...(previousProportionWidth === undefined ? {} : { previousProportionWidth }),
      };
    }),
  };
}
