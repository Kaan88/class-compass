import type { ReactNode } from 'react';
import { Tab, TabList, TabPanel, Tabs as RACTabs } from 'react-aria-components';

export interface TabItem {
  id: string;
  label: string;
  content: ReactNode;
}

/** Keyboard (arrow keys) and touch accessible tabs; the selected tab is underlined, not only coloured. */
export function Tabs({
  items,
  label,
  selectedKey,
  onSelectionChange,
}: {
  items: TabItem[];
  label: string;
  selectedKey?: string;
  onSelectionChange?: (k: string) => void;
}) {
  return (
    // `cc-tabs`: RAC marks the Tabs root data-focus-visible while ANY element inside it has keyboard
    // focus (a focus-within ring); the global [data-focus-visible] outline then drew a second ring
    // around the whole page section (S21 review). The ring belongs to the focused element only.
    <RACTabs className="cc-tabs" selectedKey={selectedKey} onSelectionChange={onSelectionChange ? (k) => onSelectionChange(String(k)) : undefined}>
      <TabList aria-label={label} className="cc-tablist">
        {items.map((i) => (
          <Tab key={i.id} id={i.id} className="cc-tab">
            {i.label}
          </Tab>
        ))}
      </TabList>
      {items.map((i) => (
        <TabPanel key={i.id} id={i.id} className="cc-tabpanel">
          {i.content}
        </TabPanel>
      ))}
    </RACTabs>
  );
}
