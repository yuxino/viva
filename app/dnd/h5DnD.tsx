import * as React from 'react';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { DndProvider } from 'react-dnd';

export default function ({ children }) {
  return <DndProvider backend={HTML5Backend}>{children}</DndProvider>;
}
