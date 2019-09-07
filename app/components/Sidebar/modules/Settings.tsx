import * as React from 'react';
import styled from 'styled-components';
import { Settings } from 'styled-icons/feather/Settings';
import { openDialog } from '@viva-ui/ui';
import { ScGithub } from 'styled-icons/evil/ScGithub';

const Contaienr = styled.div`
  padding: 25px;
  text-align: center;
`;

const Desc = styled.p`
  margin: 0;
  margin-bottom: 15px;
`;

export default {
  title: 'User Settings',
  icon: Settings,
  onClick: () => {
    const body = (
      <Contaienr key="body">
        <Desc>A personal markdown editor by Yuxino</Desc>
        <Desc>You can find me in follow way</Desc>
        <Desc>Github, Slack, Telgram etc ...</Desc>
        <Desc>version 1.0.0</Desc>
        <div>
          <ScGithub size={30} />
        </div>
      </Contaienr>
    );

    openDialog(body);
  }
};
