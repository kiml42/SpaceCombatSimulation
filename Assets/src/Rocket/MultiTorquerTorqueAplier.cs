using Assets.Src.Interfaces;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.Src.Rocket
{
    public class MultiTorquerTorqueAplier : ITorqueApplier
    {
        private List<Rigidbody> _torquers = new List<Rigidbody>();
        public float TorqueMultiplier;
        public float AngularDragWhenActive;

        public MultiTorquerTorqueAplier(Rigidbody torquer, float torqueMultiplier, float angularDragWhenActive)
        {
            _torquers = new List<Rigidbody> { torquer };
            TorqueMultiplier = torqueMultiplier;
            AngularDragWhenActive = angularDragWhenActive;
        }

        public void TurnToVectorInWorldSpace(Vector3 vector)
        {
            if (_torquers.Any())
            {
                var localSpaceVector = _torquers.First().transform.InverseTransformVector(vector).normalized;
                var rotationVector = new Vector3(-localSpaceVector.y, localSpaceVector.x, 0);
                foreach (var torquer in _torquers)
                {
                    torquer.AddRelativeTorque(TorqueMultiplier * rotationVector.normalized);
                }
                return;
            }
        }

        public void AddTorquer(Rigidbody torquer)
        {
            _torquers.Add(torquer);
        }

        public void Activate()
        {
            foreach (var torquer in _torquers)
            {
                torquer.angularDrag = AngularDragWhenActive;
            }
        }

        public void Deactivate()
        {
            foreach (var torquer in _torquers)
            {
                torquer.angularDrag = 0;
            }
        }
    }
}
