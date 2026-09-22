import Calendar from "./Calendar";
import Catalog from "./Catalog";
import FileInfo from "./FileInfo";
import Holidays from "./Holidays";
import OEE from "./OEE";
import OrderQueue from "./OrderQueue";
import SequencePriority from "./SequencePriority";

export default function () {
  return (
    <aside class="sidebar">
      <FileInfo />

      <Catalog />

      <OrderQueue />

      <Calendar />

      <Holidays />

      <OEE />

      <SequencePriority />
    </aside>
  );
}
