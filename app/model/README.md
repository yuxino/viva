## Tabs swap all case

Tabs swap is complex , so we should note what should we test ⤵️

```
Basic data struct

null <-> 1 <-> 2 <-> 3 <-> 4 <-> 5 <-> null

Case 1 swap head and tail

null <-> 5 <-> 2 <-> 3 <-> 4 <-> 1 <-> null

Case 2 swap tail and head

null <-> 5 <-> 2 <-> 3 <-> 4 <-> 1 <-> null

Case 3 swap head and item

null <-> 2 <-> 1 <-> 3 <-> 4 <-> 5 <-> null

Case 4 swap head and item

null <-> 3 <-> 2 <-> 1 <-> 4 <-> 5 <-> null

Case 5 swap tail and item

null <-> 1 <-> 2 <-> 3 <-> 5 <-> 4 <-> null

Case 6 swap tail and item

null <-> 1 <-> 2 <-> 5 <-> 4 <-> 3 <-> null

Case 7 swap between

null <-> 1 <-> 4 <-> 3 <-> 2 <-> 5 <-> null

Case 8 swap nearly

null <-> 1 <-> 2 <-> 4 <-> 3 <-> 5 <-> null

```
