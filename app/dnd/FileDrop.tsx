import * as React from 'react';
import { ConnectDropTarget, DropTargetMonitor } from 'react-dnd';
import { DropTarget, DropTargetConnector } from 'react-dnd';
import { NativeTypes } from 'react-dnd-html5-backend';
import { readFile, lstatSync, readdir } from 'fs-extra';
import styled from 'styled-components';
import { store } from '../store/configureStore';
import ViewActions from '../actions/View';

export interface DragTargetProps {
  isOver: boolean;
  canDrop: boolean;
  connectDropTarget: ConnectDropTarget;
  children: React.ReactElement;
}

const Container = styled.div`
  height: 100%;
`;

const DragTarget: React.FC<DragTargetProps> = ({
  connectDropTarget,
  children
}) => {
  return (
    <Container
      ref={instance => {
        connectDropTarget(instance);
      }}
    >
      {children}
    </Container>
  );
};

export default DropTarget(
  NativeTypes.FILE,
  {
    drop(props: DragTargetProps, monitor: DropTargetMonitor) {
      (async () => {
        const files = monitor.getItem().files;
        // single file ...
        const file = files[0];
        const path = file.path;

        // content handler
        if (lstatSync(path).isFile()) {
          const buffer = await readFile(path);
          const content = buffer.toString();
          const fileInfo = { content, name: file.name };
          // update tabs view
          store.dispatch({
            type: ViewActions.TABS_UPDATE,
            payload: { fileInfo }
          });
        } else {
          // console.log(path);
          // const dirs = await readdir(path);
          const fileInfo = { path: path };
          store.dispatch({
            type: ViewActions.OPEN_DIR,
            payload: { fileInfo }
          });
        }
      })();
    }
  },
  (connect: DropTargetConnector, monitor: DropTargetMonitor) => ({
    connectDropTarget: connect.dropTarget(),
    isOver: monitor.isOver(),
    canDrop: monitor.canDrop()
  })
)(DragTarget);
