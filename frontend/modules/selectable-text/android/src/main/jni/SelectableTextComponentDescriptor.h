#pragma once

#include "SelectableTextShadowNode.h"

#include <react/renderer/core/ConcreteComponentDescriptor.h>

namespace facebook::react {

class SelectableTextComponentDescriptor final
    : public ConcreteComponentDescriptor<SelectableTextShadowNode> {
 public:
  using ConcreteComponentDescriptor::ConcreteComponentDescriptor;

  void adopt(ShadowNode& shadowNode) const override {
    ConcreteComponentDescriptor::adopt(shadowNode);
    static_cast<SelectableTextShadowNode&>(shadowNode)
        .setContextContainer(contextContainer_);
  }
};

} // namespace facebook::react
