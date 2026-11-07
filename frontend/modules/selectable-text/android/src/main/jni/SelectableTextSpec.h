#pragma once

#include <ReactCommon/JavaTurboModule.h>
#include <jsi/jsi.h>

#include "SelectableTextComponentDescriptor.h"

namespace facebook::react {

JSI_EXPORT
std::shared_ptr<TurboModule> SelectableTextSpec_ModuleProvider(
    const std::string& moduleName,
    const JavaTurboModule::InitParams& params);

} // namespace facebook::react
