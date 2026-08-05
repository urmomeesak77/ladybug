import type { ReactNode } from 'react';

import { useTabsKeyboard } from '../hooks/useTabsKeyboard';
import type { UploadMode } from '../lib/uploadModel';

// The three media choices, in display order. Image is first, so it is the default selection.
const TABS: { id: UploadMode; label: string }[] = [
  { id: 'image', label: 'Image' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'video', label: 'Video' },
];

// The upload form's media-type chooser: a WAI-ARIA tablist ("Image" default, "YouTube")
// replacing the old radio group. Controlled — the parent owns the selected mode. Only the active
// tab's panel (its input, passed as children) is rendered, so the server's either/or rule cannot
// be violated from the UI. Keyboard operation and roving tabindex come from useTabsKeyboard.
function MediaTabs({ selected, onSelect, children }: {
  selected: UploadMode;
  onSelect: (mode: UploadMode) => void;
  children: ReactNode;
}) {
  const selectedIndex = TABS.findIndex((tab) => tab.id === selected);
  const { tabRefs, onKeyDown, tabIndex } = useTabsKeyboard(
    TABS.length,
    selectedIndex,
    (index) => onSelect(TABS[index].id),
  );

  return (
    <div className="media-tabs">
      <div className="media-tabs__list" role="tablist" aria-label="What are you posting?" onKeyDown={onKeyDown}>
        {TABS.map((tab, index) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`media-tab-${tab.id}`}
            aria-selected={tab.id === selected}
            aria-controls={`media-panel-${tab.id}`}
            tabIndex={tabIndex(index)}
            ref={(node) => { tabRefs.current[index] = node; }}
            className={tab.id === selected ? 'media-tabs__tab media-tabs__tab--selected' : 'media-tabs__tab'}
            onClick={() => onSelect(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`media-panel-${selected}`}
        aria-labelledby={`media-tab-${selected}`}
        className="media-tabs__panel"
      >
        {children}
      </div>
    </div>
  );
}

export default MediaTabs;
