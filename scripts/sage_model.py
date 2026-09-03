"""GraphSAGE counterpart of the team's GATLP, for architecture comparison.

Mirrors GATLP's constructor and forward contract exactly (same type/node
embeddings, same LayerNorm/ELU/dropout stack) so it can be monkeypatched
into the team trainer without touching team code — the ONLY change is
the message-passing layer: SAGEConv (mean-aggregation, no attention)
instead of GATConv. SAGEConv has no edge-attribute pathway, so this
variant is inherently "no edge features"; train and label it that way.

The team pipeline stays unmodified: run_gat_single/compute_gat_predictions
swap `components.gat.GATLP` (and their own reference) for this class when
--arch sage is passed.
"""

from __future__ import annotations

import torch
import torch.nn as nn
from torch_geometric.data import Data
from torch_geometric.nn import SAGEConv


class SAGELP(nn.Module):
    def __init__(self, in_ch: int, hid: int = 256, heads1: int = 4,
                 dropout: float = 0.6, num_classes: int = 0,
                 num_global_nodes: int = 0, num_rels: int = 1,
                 num_cats: int = 1, use_edge_types: bool = True):
        super().__init__()
        # heads1 / use_edge_types accepted for signature parity; SAGE has
        # neither attention heads nor an edge-feature pathway.
        self.use_edge_types = False
        self.edge_dim_internal = 1

        self.type_emb = nn.Embedding(num_classes + 1, hid, padding_idx=0)
        nn.init.xavier_uniform_(self.type_emb.weight)
        self.node_emb = nn.Embedding(num_global_nodes, hid, padding_idx=0)
        nn.init.xavier_uniform_(self.node_emb.weight)

        self.lin_input = nn.Linear(in_ch, hid)
        self.ln1 = nn.LayerNorm(hid)
        self.sage1 = SAGEConv(hid, hid)
        self.ln2 = nn.LayerNorm(hid)
        self.sage2 = SAGEConv(hid, hid)

        self.classifier = nn.Linear(hid, num_classes) if num_classes > 0 else None
        self.elu = nn.ELU()
        self.drop = nn.Dropout(dropout)
        self.id_dropout_prob = 0.5

    def forward(self, data: Data) -> torch.Tensor:
        x, edge_index, n_id = data.x, data.edge_index, data.n_id

        node_type_ids = getattr(data, "node_type", None)
        if node_type_ids is None:
            node_type_ids = torch.zeros(x.size(0), dtype=torch.long, device=x.device)

        x_dense = self.lin_input(x)
        x_type = self.type_emb(node_type_ids)

        if self.training:
            mask = torch.rand(n_id.size(0), device=n_id.device) > self.id_dropout_prob
            id_emb = self.node_emb(n_id) * mask.unsqueeze(1)
        else:
            id_emb = self.node_emb(n_id)

        x = x_dense + x_type + id_emb
        x = self.ln1(x)
        x = self.sage1(x, edge_index)
        x = self.ln2(x)
        x = self.elu(x)
        x = self.drop(x)
        x = self.sage2(x, edge_index)
        return x

    def classify(self, emb: torch.Tensor) -> torch.Tensor:
        if self.classifier is None:
            raise ValueError("No classifier head.")
        return self.classifier(emb)
