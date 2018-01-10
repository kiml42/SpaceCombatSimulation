using System.Collections;
using System.Collections.Generic;
using UnityEngine;

namespace Assets.Src.ModuleSystem
{
    public class ModuleTypeKnower : MonoBehaviour
    {
        [Tooltip("the list of types that this module can act as.")]
        public List<ModuleType> Types;

        [Tooltip("the cost for this module when evolving ships.")]
        public float Cost = 100;
    }
}
