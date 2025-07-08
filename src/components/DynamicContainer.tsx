import React, { ReactNode, useState } from "react";
import Split from "react-split";

/**
 * A thin wrapper around `react-split` with a minimal swap‑mechanism.
 *
 * – Drag the gutter to resize.
 * – Accepts 2‑n children.
 */
interface DynamicContainerProps {
  children: ReactNode[];
  /** Vertical or horizontal split ‑ defaults to horizontal */
  direction?: "horizontal" | "vertical";
  sizes? : number[];
}

const DynamicContainer: React.FC<DynamicContainerProps> = ({
  children,
  direction = "horizontal",
  sizes = Array(children.length).fill(100 / children.length),
}) => {
  const [order, setOrder] = useState(children.map((_, i) => i));

  return (
    <Split
      className={`${
        direction === "horizontal" ? "flex" : "flex flex-col"
      } h-full w-full`}
      sizes={sizes}
      minSize={200}
      snapOffset={0}
      gutterSize={6}
      direction={direction}
      gutter={(idx) => {
        const g = document.createElement("div");
        g.className =
          "bg-gray-300 hover:bg-gray-400 transition-colors duration-150";
        return g;
      }}
    >
      {order.map((i) => (
        <div key={i} className="h-full w-full overflow-hidden">
          {children[i]}
        </div>
      ))}
    </Split>
  );
};

export default DynamicContainer;
