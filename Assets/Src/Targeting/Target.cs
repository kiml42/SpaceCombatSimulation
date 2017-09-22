using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.Src.Targeting
{
    /// <summary>
    /// Class for wrapping target rigidbody and transform
    /// </summary>
    public class Target
    {
        public Transform Transform { get; private set; }
        public Rigidbody Rigidbody { get; private set; }

        public Target()
        {

        }
        
        public Target(Rigidbody target)
        {
            Rigidbody = target;
            Transform = target.transform;
        }

        public Target(Transform target)
        {
            Transform = target;
            Rigidbody = target.GetComponent("Rigidbody") as Rigidbody;
        }
    }
}
