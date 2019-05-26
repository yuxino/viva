import * as React from 'react';
import styled from 'styled-components';
import TitleBar from './TitleBar';
import { ipcRenderer } from 'electron';
import { Close } from 'styled-icons/evil/Close';

const CloseIcon = styled(Close)`
  -webkit-app-region: no-drag;
  cursor: pointer;
`;

export default function() {
  const exitApp = () => {
    console.log(ipcRenderer);
    ipcRenderer.send('close');
  };

  return (
    <TitleBar>
      <TitleBar.Right>
        <CloseIcon size={15} color="#8c8c8c" onClick={exitApp} />
      </TitleBar.Right>
    </TitleBar>
  );
}
