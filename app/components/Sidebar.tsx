import * as React from 'react';
import styled from 'styled-components';
import { FileBlank } from 'styled-icons/boxicons-regular/FileBlank';
import { GitBranch } from 'styled-icons/boxicons-regular/GitBranch';
import { Search } from 'styled-icons/boxicons-regular/Search';
import { FilePdf } from 'styled-icons/icomoon/FilePdf';
import { Settings } from 'styled-icons/feather/Settings';
import { Fullscreen } from 'styled-icons/boxicons-regular/Fullscreen';

const Container = styled.div`
  border-right: 1px solid #eae9e7;
  padding: 20px 8px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
`;

const IconGroup = styled.ul`
  margin: 0;
  padding: 0;
  list-style: none;
`;

const IconGroupItem = styled.li`
  & + & {
    margin-top: 15px;
  }
  svg {
    cursor: pointer;
  }
  &:hover {
    svg {
      color: black;
    }
  }
  padding: 10px 15px;
`;

function Sidebar() {
  return (
    <Container>
      <IconGroup>
        <IconGroupItem title="Explorer">
          <FileBlank size={20} color="#8c8c8c" />
        </IconGroupItem>
        <IconGroupItem title="Source Control">
          <GitBranch size={20} color="#8c8c8c" />
        </IconGroupItem>
        <IconGroupItem title="Search">
          <Search size={20} color="#8c8c8c" />
        </IconGroupItem>
        <IconGroupItem title="Full Screen">
          <Fullscreen size={20} color="#8c8c8c" />
        </IconGroupItem>
        <IconGroupItem title="Export To Pdf">
          <FilePdf size={20} color="#8c8c8c" />
        </IconGroupItem>
      </IconGroup>

      <IconGroup>
        <IconGroupItem title="User Settings">
          <Settings size={20} color="#8c8c8c" />
        </IconGroupItem>
      </IconGroup>
    </Container>
  );
}

export default Sidebar;
