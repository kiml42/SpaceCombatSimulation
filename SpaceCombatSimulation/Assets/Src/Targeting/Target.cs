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
        private ShipType? _type;
        public ShipType Type
        {
            get
            {
                if (!_type.HasValue)
                {
                    var typeKnower = Transform.GetComponent<TypeKnower>();
                    if(typeKnower == null)
                    {
                        Debug.LogWarning(Transform + " has no TypeKnower");
                        _type = ShipType.Fighter;
                    } else
                    {
                        _type = typeKnower.Type;
                    }
                }
                return _type.Value;
            }
        }
        
        public Target(Rigidbody target)
        {
            Rigidbody = target;
            if(target == null)
            {
                Debug.LogWarning("Created target for null rigidbody");
                return;
            }
            Transform = target.transform;
        }

        public Target(Transform target)
        {
            Transform = target;
            if (target == null)
            {
                Debug.LogWarning("Created target for null transform");
                return;
            }
            Rigidbody = target.GetComponent<Rigidbody>();
        }

        public Target(Target target)
        {
            Transform = target.Transform;
            Rigidbody = target.Rigidbody;
        }

        public bool Equals(Target other)
        {
            Debug.Log("Using my equals");
            return Transform == other.Transform;
        }
    }

    sealed class CompareTargetsByTransform : IEqualityComparer<Target>
    {
        public bool Equals(Target x, Target y)
        {
            Debug.Log("MyEquals");
            if (x == null)
                return y == null;
            else if (y == null)
                return false;
            else
                return x.Transform == y.Transform;
        }

        public int GetHashCode(Target obj)
        {
            return obj.Transform.GetHashCode();
        }
    }
}
