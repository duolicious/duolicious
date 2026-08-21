from PIL import Image
from typing import List
import numpy as np
import numpy.typing as npt
import onnxruntime as ort
import argparse
from pathlib import Path
from io import BytesIO
from pathlib import Path

_MODEL_PATH_BASE = Path(__file__).parent.parent / 'antiporn'

_MODEL_PARTS = bytearray()
for file_path in sorted(_MODEL_PATH_BASE.glob('model.onnx.part*')):
    with open(file_path, 'rb') as file:
        _MODEL_PARTS.extend(file.read())
_MODEL = bytes(_MODEL_PARTS)

# Create a global ONNX runtime session
_SESSION = ort.InferenceSession(_MODEL)
_INPUT_NAME = _SESSION.get_inputs()[0].name

def avg(*n: float) -> float:
    return sum(n) / float(len(n))

def preprocess_for_evaluation(
    image: Image.Image,
    image_size: int,
) -> npt.NDArray[np.float16]:
    """
    Preprocess image for evaluation
    Parameters
    ----------
    image : Image.Image
        Image to be preprocessed
    image_size : int
        Height/Width of image to be resized to
    Returns
    -------
    image : np.array
        Image ready for evaluation
    """
    resized_image = pad_resize_image(image, image_size)
    image_array = np.array(resized_image, dtype=np.float16)
    image_array -= 128
    image_array /= 128
    return image_array

def pad_resize_image(image: Image.Image, target_size: int) -> Image.Image:
    """
    Pad the image and resize it to target size using bilinear interpolation.
    Parameters
    ----------
    image : Image.Image
        Image to be padded and resized
    target_size : int
        New size for the height/width of the image
    Returns
    -------
    resized_image : Image.Image
        Resized and padded image
    """
    old_size = image.size
    ratio = float(target_size) / max(old_size)
    new_size = (int(old_size[0] * ratio), int(old_size[1] * ratio))
    image = image.resize(new_size, Image.BILINEAR)
    new_im = Image.new("RGB", (target_size, target_size))
    new_im.paste(image, ((target_size - new_size[0]) // 2, (target_size - new_size[1]) // 2))
    return new_im

def read_image_from_bytes(
    image_data: BytesIO,
    flip_mode: str = "none",
) -> npt.NDArray[np.float16]:
    """
    Load and preprocess image from a BytesIO object for inference.
    Parameters
    ----------
    image_data : BytesIO
        Image data as BytesIO object
    Returns
    -------
    image : np.array
        Image ready for inference, not adding batch dimension here

    flip_mode can be:
    - "none": no flipping
    - "horizontal": flip horizontally
    - "vertical": flip vertically
    """
    image_data.seek(0)  # Ensure start of stream
    image = Image.open(image_data).convert('RGB')

    if flip_mode == "none":
        pass
    elif flip_mode == "horizontal":
        image = image.transpose(Image.FLIP_LEFT_RIGHT)
    elif flip_mode == "vertical":
        image = image.transpose(Image.FLIP_TOP_BOTTOM)
    else:
        raise ValueError("Invalid flip mode")

    image_array = preprocess_for_evaluation(image, 480)

    return image_array.flatten()

def predict_nsfw(image_data_list: List[BytesIO]) -> List[float]:
    """
    Predict NSFW content in given images using batch processing, comparing:
    - The original image
    - The horizontally flipped image
    - The vertically flipped image

    Final score is the smallest prediction among the three variants.
    """
    if not image_data_list:
        return []

    # Prepare batches for all flip modes
    batch_images_original = np.array([
        read_image_from_bytes(img_data, flip_mode="none")
        for img_data in image_data_list], dtype=np.float16)

    batch_images_hflip = np.array([
        read_image_from_bytes(img_data, flip_mode="horizontal")
        for img_data in image_data_list], dtype=np.float16)

    batch_images_vflip = np.array([
        read_image_from_bytes(img_data, flip_mode="vertical")
        for img_data in image_data_list], dtype=np.float16)

    # Run inference
    preds_original = _SESSION.run(None, {_INPUT_NAME: batch_images_original})[0]
    preds_hflip    = _SESSION.run(None, {_INPUT_NAME: batch_images_hflip})[0]
    preds_vflip    = _SESSION.run(None, {_INPUT_NAME: batch_images_vflip})[0]

    # Take the minimum prediction out of original, horizontal flip, and vertical flip
    final_scores = [
        avg(
            float(orig[0]),
            float(hflip[0]),
            float(vflip[0]),
        )
        for orig, hflip, vflip in zip(preds_original, preds_hflip, preds_vflip)
    ]

    return final_scores
