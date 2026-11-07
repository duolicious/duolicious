import json
import sys
from pathlib import Path

import numpy as np
import numpy.typing as npt
import onnx
from onnx import TensorProto, helper, numpy_helper

source, target = map(Path, sys.argv[1:])

with source.open('rb') as file:
    header_size = int.from_bytes(file.read(8), 'little')
    header = json.loads(file.read(header_size))

nodes: list[onnx.NodeProto] = []
initializers: list[onnx.TensorProto] = []


def weight(name: str) -> npt.NDArray[np.float32]:
    tensor = header[name]
    return np.fromfile(
        source,
        dtype='<f4',
        count=int(np.prod(tensor['shape'])),
        offset=8 + header_size + tensor['data_offsets'][0],
    ).reshape(tensor['shape'])


def constant(value: npt.NDArray[np.float32] | npt.NDArray[np.int64]) -> str:
    name = f'constant{len(initializers)}'
    initializers.append(numpy_helper.from_array(value, name))
    return name


def op(op_type: str, *inputs: str, **attributes: int | float | list[int]) -> str:
    output = f'{op_type}{len(nodes)}'
    node = helper.make_node(op_type, inputs, [output])
    node.attribute.extend(helper.make_attribute(k, v) for k, v in attributes.items())
    nodes.append(node)
    return output


def layer_norm(name: str, x: str) -> str:
    return op(
        'LayerNormalization',
        x,
        constant(weight(f'{name}.weight')),
        constant(weight(f'{name}.bias')),
        epsilon=1e-5)


def linear(name: str, x: str) -> str:
    return op(
        'Add',
        op('MatMul', x, constant(weight(f'{name}.weight').T)),
        constant(weight(f'{name}.bias')))


heads = constant(np.array([257, 16, 64]))
width = constant(np.array([257, 1024]))

x = op('Reshape', 'pixels', constant(np.array([3, 16, 14, 16, 14])))
x = op('Reshape', op('Transpose', x, perm=[1, 3, 0, 2, 4]), constant(np.array([256, 588])))
x = op(
    'MatMul',
    x,
    constant(weight('vision_model.embeddings.patch_embedding.weight').reshape(1024, 588).T))
x = op('Concat', constant(weight('vision_model.embeddings.class_embedding')[None]), x, axis=0)
x = op('Add', x, constant(weight('vision_model.embeddings.position_embedding.weight')))
x = layer_norm('vision_model.pre_layrnorm', x)

for layer in range(24):
    name = f'vision_model.encoder.layers.{layer}'

    q, k, v = (
        op('Reshape', linear(f'{name}.self_attn.{p}_proj', layer_norm(f'{name}.layer_norm1', x)), heads)
        for p in 'qkv')
    scores = op(
        'Mul',
        op('MatMul', op('Transpose', q, perm=[1, 0, 2]), op('Transpose', k, perm=[1, 2, 0])),
        constant(np.array(1 / 8, dtype=np.float32)))
    attention = op('MatMul', op('Softmax', scores, axis=-1), op('Transpose', v, perm=[1, 0, 2]))
    x = op('Add', x, linear(
        f'{name}.self_attn.out_proj',
        op('Reshape', op('Transpose', attention, perm=[1, 0, 2]), width)))

    h = linear(f'{name}.mlp.fc1', layer_norm(f'{name}.layer_norm2', x))
    quick_gelu = op('Mul', h, op('Sigmoid', op('Mul', h, constant(np.array(1.702, dtype=np.float32)))))
    x = op('Add', x, linear(f'{name}.mlp.fc2', quick_gelu))

x = op('Slice', x, constant(np.array([0])), constant(np.array([1])))
x = op('MatMul', layer_norm('vision_model.post_layernorm', x), constant(weight('visual_projection.weight').T))
x = op('LpNormalization', x, axis=-1, p=2)

onnx.save(
    helper.make_model(
        helper.make_graph(
            nodes,
            'clip-vit-large-patch14-vision',
            [helper.make_tensor_value_info('pixels', TensorProto.FLOAT, [3, 224, 224])],
            [helper.make_tensor_value_info(x, TensorProto.FLOAT, [1, 768])],
            initializers),
        ir_version=8,
        opset_imports=[helper.make_opsetid('', 17)]),
    target)
