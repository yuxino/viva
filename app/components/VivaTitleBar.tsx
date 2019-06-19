import * as React from 'react';
import styled from 'styled-components';
import TitleBar from './TitleBar';
import { ipcRenderer } from 'electron';
import { Close } from 'styled-icons/evil/Close';
import { useMappedState } from 'redux-react-hook';

const CloseIcon = styled(Close)`
  -webkit-app-region: no-drag;
  cursor: pointer;
`;

const Title = styled(TitleBar.Content)`
  font-size: 14px;
`

export default function () {
  const exitApp = () => {
    ipcRenderer.send('close');
  };

  const { title } = useMappedState(state => ({
    title: state.titlebar.title
  }))

  return (
    <TitleBar>
      <Title>{title}</Title>
      <TitleBar.Right>
        <CloseIcon size={15} color="#8c8c8c" onClick={exitApp} />
      </TitleBar.Right>
    </TitleBar>
  );
}
