using Assets.Src.Interfaces;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

namespace Assets.Src.ModuleSystem
{
    public class ModuleRecord
    {
        private readonly int? _moduleNumber;
        private readonly string _moduleName;
        private List<ModuleRecord> _childModules;

        public ModuleRecord(int? moduleNumber = null, string moduleName = null, bool isHub = false)
        {
            _moduleNumber = moduleNumber;
            _moduleName = ProcessName(moduleName);
            if (isHub)
            {
                _childModules = new List<ModuleRecord>();
            }
        }

        public ModuleRecord(IModuleTypeKnower moduleTypeKnower, int? moduleNumber = null) : this(moduleNumber)
        {
            if(moduleTypeKnower != null)
            {
                _moduleName = ProcessName(moduleTypeKnower.Name);
                if(moduleTypeKnower.Types != null && moduleTypeKnower.Types.Contains(ModuleType.Hub))
                {
                    _childModules = new List<ModuleRecord>();
                }
            }
        }

        private string ProcessName(string original)
        {
            if (string.IsNullOrEmpty(original))
            {
                return null;
            }
            var processed = original.Replace("(Clone)", "");
            processed = string.IsNullOrEmpty(processed) ? original : processed;
            return processed.Replace("(", "").Replace(")", "");
        }

        public void AddModule(ModuleRecord module)
        {
            if(_childModules == null)
            {
                _childModules = new List<ModuleRecord>();
            }
            _childModules.Add(module);
        }

        public void AddModule(IModuleTypeKnower module, int? moduleNumber = null)
        {
            AddModule(new ModuleRecord(module, moduleNumber));
        }

        public override string ToString()
        {
            var sb = new StringBuilder();
            if (_moduleNumber.HasValue)
            {
                sb.Append(_moduleNumber.Value);
            }

            if(_childModules != null)
            {
                sb.Append("(");
                var moduleStrings = _childModules.Select(m => m == null ? "-" : m.ToString()).ToArray();
                sb.Append(string.Join(",", moduleStrings));
                sb.Append(")");
            }

            return sb.ToString();
        }

        internal string ToSimpleString()
        {
            //TODO make this return a summary of what modules are used, and how many of each.
            return ToString();
        }

        internal string ToSimpleStringWithFullNames()
        {
            //TODO make this return a summary of what modules are used, and how many of each.
            return ToStringWithFullNames();
        }

        public string ToStringWithFullNames()
        {
            var sb = new StringBuilder();
            sb.Append(_moduleName);

            if (_childModules != null)
            {
                sb.Append("(");
                var moduleStrings = _childModules.Select(m => m == null ? "-" : m.ToStringWithFullNames()).ToArray();
                sb.Append(string.Join(",", moduleStrings));
                sb.Append(")");
            }

            return sb.ToString();
        }
    }
}
