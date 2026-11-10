import { ICON_NAMES, Icon } from "@/components/ui/Icon";

/** All 111 icons at the four sizes they are used at: 16 tables, 18 buttons, 20 tiles, 24 empty states. */
export function IconSection() {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
      {ICON_NAMES.map((name) => (
        <div
          key={name}
          data-icon-tile
          className="flex flex-col gap-2 rounded-ms-ctl bg-ms-card p-3 text-ms-fg shadow-ms-1"
        >
          <div className="flex items-center gap-2.5 text-ms-fg-2">
            <Icon name={name} size="sm" />
            <Icon name={name} size="md" />
            <Icon name={name} size="lg" />
            <Icon name={name} size="xl" className="text-ms-fg" />
          </div>
          <span className="font-ms-mono text-[12px] text-ms-fg-3">{name}</span>
        </div>
      ))}
    </div>
  );
}
