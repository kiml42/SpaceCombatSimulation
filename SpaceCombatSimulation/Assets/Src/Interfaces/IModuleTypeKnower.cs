using Assets.Src.ModuleSystem;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

namespace Assets.Src.Interfaces
{
    public interface IModuleTypeKnower: IGeneticConfigurable
    {
        string Name { get; }
        List<ModuleType> ModuleTypes { get; }
        float ModuleCost { get; }
    }
}
