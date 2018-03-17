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
        private string _moduleName { get
            {
                var processed = ProcessName(_baseName);

                if (string.IsNullOrEmpty(processed) && _moduleNumber.HasValue)
                {
                    return _moduleNumber.Value.ToString();
                }

                return processed;
            }
        }
        private readonly string _baseName;
        private List<ModuleRecord> _childModules;

        public ModuleRecord(int? moduleNumber = null, string moduleName = null, bool isHub = false)
        {
            _moduleNumber = moduleNumber;
            _baseName = moduleName;
            if (isHub)
            {
                _childModules = new List<ModuleRecord>();
            }
        }

        public ModuleRecord(IModuleTypeKnower moduleTypeKnower, int? moduleNumber = null) : this(moduleNumber)
        {
            if(moduleTypeKnower != null)
            {
                _baseName = moduleTypeKnower.Name;
                if(moduleTypeKnower.ModuleTypes != null && moduleTypeKnower.ModuleTypes.Contains(ModuleType.Hub))
                {
                    _childModules = new List<ModuleRecord>();
                }
            }
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

        protected List<int?> ListUsedModuleNumbers()
        {
            var list = new List<int?>
            {
                _moduleNumber
            };

            if(_childModules != null)
            {
                foreach (var module in _childModules.Where(m => m!= null))
                {
                    list.AddRange(module.ListUsedModuleNumbers());
                }
            }

            return list;
        }

        protected List<string> ListUsedModuleNames()
        {
            var list = new List<string>
            {
                _moduleName
            };

            if (_childModules != null)
            {
                foreach (var module in _childModules.Where(m => m != null))
                {
                    list.AddRange(module.ListUsedModuleNames());
                }
            }

            return list;
        }

        public string ToSimpleString()
        {
            var sb = new StringBuilder();

            var list = ListUsedModuleNumbers();
            
            var map = new Dictionary<int, int>();

            foreach(var n in list.Where(n => n.HasValue).Distinct())
            {
                map[n.Value] = list.Count(x => x == n);
            }

            var strings = map.OrderByDescending(kv => kv.Value).ThenBy(kv => kv.Key).Select(kv => (kv.Value > 1 ? kv.Value + "*" : "") + kv.Key);

            sb.Append(string.Join(",", strings.ToArray()));

            return sb.ToString();
        }

        public string ToSimpleStringWithFullNames()
        {
            var sb = new StringBuilder();

            var list = ListUsedModuleNames();

            var map = new Dictionary<string, int>();

            foreach (var n in list.Where(n => !string.IsNullOrEmpty(n)).Distinct())
            {
                map[n] = list.Count(x => x == n);
            }

            var strings = map.OrderByDescending(kv => kv.Value).ThenBy(kv => kv.Key).Select(kv => (kv.Value > 1 ? kv.Value + "*" : "") + kv.Key);

            sb.Append(string.Join(",", strings.ToArray()));

            return sb.ToString();
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
    }
}
