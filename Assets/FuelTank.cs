using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class FuelTank : MonoBehaviour {
    public float Fuel;

    public bool UseFuelMass = false;
    /// <summary>
    /// Mass will be added to the Rigidbody(if present) = to FuelDensity * Fuel.
    /// 1gram per unit by default.
    /// </summary>
    [Tooltip("In kg per unit")]
    public float FuelDensity = 0.001f;

    private float _originalMass;
    private Rigidbody _rigidbody;

    public void Start()
    {
        if (UseFuelMass)
        {
            _rigidbody = GetComponent<Rigidbody>();
            _originalMass = _rigidbody.mass;
            SetMassIncludingFuel();
        }
    }

    public float DrainFuel(float requestedFuel)
    {
        if(Fuel <= 0)
        {
            return 0;
        }
        var fuelToReturn = Math.Min(requestedFuel, Fuel);
        Fuel -= fuelToReturn;
        if (UseFuelMass)
        {
            SetMassIncludingFuel();
        }
        return fuelToReturn;
    }

    private void SetMassIncludingFuel()
    {
        _rigidbody.mass = _originalMass + Fuel * FuelDensity;
    }
}
