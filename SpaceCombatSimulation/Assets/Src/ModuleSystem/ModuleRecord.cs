using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

namespace Assets.Src.ModuleSystem
{
    public class ModuleRecord
    {
        private int? ModuleNumber;
        private string ModuleName;
        private List<ModuleRecord> ChildModules;

        public ModuleRecord(int? moduleNumber = null, string moduleName = null, bool isHub = false)
        {
            ModuleNumber = moduleNumber;
            ModuleName = moduleName;
            if (isHub)
            {
                ChildModules = new List<ModuleRecord>();
            }
        }

        public ModuleRecord(ModuleTypeKnower moduleTypeKnower, int? moduleNumber = null) : this(moduleNumber)
        {
            if(moduleTypeKnower != null)
            {
                ModuleName = moduleTypeKnower.name;
                if(moduleTypeKnower.Types != null && moduleTypeKnower.Types.Contains(ModuleType.Hub))
                {
                    ChildModules = new List<ModuleRecord>();
                }
            }
        }

        public void AddModule(ModuleRecord module)
        {
            if(ChildModules == null)
            {
                ChildModules = new List<ModuleRecord>();
            }
            ChildModules.Add(module);
        }

        public void AddModule(ModuleTypeKnower module, int? moduleNumber = null)
        {
            AddModule(new ModuleRecord(module, moduleNumber));
        }

        public override string ToString()
        {
            var sb = new StringBuilder();
            if (ModuleNumber.HasValue)
            {
                sb.Append(ModuleNumber.Value);
            }

            if(ChildModules != null)
            {
                sb.Append("(");
                var moduleStrings = ChildModules.Select(m => m == null ? "-" : m.ToString()).ToArray();
                sb.Append(string.Join(",", moduleStrings));
                sb.Append(")");
            }

            return sb.ToString();
        }

        public string ToVerboseString()
        {
            var sb = new StringBuilder();
            sb.Append(ModuleName);

            if (ChildModules != null)
            {
                sb.Append("(");
                var moduleStrings = ChildModules.Select(m => m == null ? "-" : m.ToVerboseString()).ToArray();
                sb.Append(string.Join(",", moduleStrings));
                sb.Append(")");
            }

            return sb.ToString();
        }
    }
}
