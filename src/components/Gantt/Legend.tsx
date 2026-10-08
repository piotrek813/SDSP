import { JSX, Show } from "solid-js";
import { useMainStore } from "../../Context";

type LegendItemProps = {
  color?: string;
  children?: JSX.Element;
  text: string;
  className?: string;
};

function LegendItem({ color, children, text, className }: LegendItemProps) {
  return (
    <span class="legend-item">
      <Show
        when={children}
        fallback={
          <span class={`legend-swatch ${className ?? ""}`} style={color}></span>
        }
      >
        {children}
      </Show>
      {text}
    </span>
  );
}

export default function () {
  const { state } = useMainStore();

  return (
    <div id="legend" class="legend">
      <LegendItem text="Changeover" className="changeover" />
      <LegendItem text="Break">
        <span class="hatch"></span>
      </LegendItem>
      <LegendItem text="Holiday" className="holiday" />
      <LegendItem text="Failure">
        <span class="hatch fail"></span>
      </LegendItem>
      <LegendItem text="Off shift" color="#f0ede6" />
      <Show when={state.showIdeal}>
        <LegendItem text="100% OEE">
          <span class="ghost"></span>
        </LegendItem>
      </Show>
    </div>
  );
}
