"""The matching model at serving time.

`backend/kvmatching` trains the model and freezes its weights, together with
the feature vocabulary they were fitted against, into `kv_model.npz`. This
package turns a person's database rows back into those features and runs the
encoders over them in numpy, so neither torch nor scipy reaches the backend.
The training pipeline imports these modules too, so this `__init__` has to
stay importable without the service dependencies.

Every person comes out with a `value` (who they are) and a `key` (what they
are looking for), each 66 dimensions with the model's desirability and
eagerness bias scalars folded in as extra dimensions. One inner product of
someone's key against another's value scores "A is looking for B", so summing
both directions scores a pair.
"""
